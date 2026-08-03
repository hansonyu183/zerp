package httpserver

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers/gorillamux"
	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
)

type bufferedResponseWriter struct {
	gin.ResponseWriter
	body        bytes.Buffer
	status      int
	wroteHeader bool
}

func newBufferedResponseWriter(writer gin.ResponseWriter) *bufferedResponseWriter {
	return &bufferedResponseWriter{ResponseWriter: writer, status: http.StatusOK}
}

func (writer *bufferedResponseWriter) WriteHeader(status int) {
	if writer.wroteHeader {
		return
	}
	writer.status = status
}

func (writer *bufferedResponseWriter) WriteHeaderNow() {
	writer.wroteHeader = true
}

func (writer *bufferedResponseWriter) Write(data []byte) (int, error) {
	writer.WriteHeaderNow()
	return writer.body.Write(data)
}

func (writer *bufferedResponseWriter) WriteString(data string) (int, error) {
	writer.WriteHeaderNow()
	return writer.body.WriteString(data)
}

func (writer *bufferedResponseWriter) Status() int {
	return writer.status
}

func (writer *bufferedResponseWriter) Size() int {
	if !writer.wroteHeader {
		return -1
	}
	return writer.body.Len()
}

func (writer *bufferedResponseWriter) Written() bool {
	return writer.wroteHeader
}

func (writer *bufferedResponseWriter) Flush() {
	writer.WriteHeaderNow()
}

func (writer *bufferedResponseWriter) replace(status int, contentType string, data []byte) {
	writer.status = status
	writer.wroteHeader = true
	writer.Header().Set("Content-Type", contentType)
	writer.body.Reset()
	_, _ = writer.body.Write(data)
}

func (writer *bufferedResponseWriter) flush() error {
	writer.ResponseWriter.WriteHeader(writer.status)
	_, err := writer.ResponseWriter.Write(writer.body.Bytes())
	return err
}

func validateOpenAPIResponses(swagger *openapi3.T, logger *slog.Logger) gin.HandlerFunc {
	router, err := gorillamux.NewRouter(swagger)
	if err != nil {
		panic("create OpenAPI response router: " + err.Error())
	}
	if logger == nil {
		logger = slog.Default()
	}

	return func(context *gin.Context) {
		if !shouldValidateJSONResponse(context.Request.URL.Path) {
			context.Next()
			return
		}

		originalWriter := context.Writer
		bufferedWriter := newBufferedResponseWriter(originalWriter)
		context.Writer = bufferedWriter
		context.Next()
		context.Writer = originalWriter

		route, pathParams, routeErr := router.FindRoute(context.Request)
		if routeErr == nil {
			requestInput := &openapi3filter.RequestValidationInput{
				Request:    context.Request,
				PathParams: pathParams,
				Route:      route,
			}
			responseInput := &openapi3filter.ResponseValidationInput{
				RequestValidationInput: requestInput,
				Status:                 bufferedWriter.Status(),
				Header:                 bufferedWriter.Header(),
				Body:                   io.NopCloser(bytes.NewReader(bufferedWriter.body.Bytes())),
			}
			if validationErr := openapi3filter.ValidateResponse(context.Request.Context(), responseInput); validationErr != nil {
				logger.ErrorContext(
					context.Request.Context(),
					"OpenAPI response validation failed",
					"method", context.Request.Method,
					"path", context.Request.URL.Path,
					"requestId", response.RequestID(context),
					"error", validationErr,
				)
				replaceInvalidResponse(context, bufferedWriter)
			}
		}

		if flushErr := bufferedWriter.flush(); flushErr != nil {
			logger.ErrorContext(
				context.Request.Context(),
				"flush validated response",
				"method", context.Request.Method,
				"path", context.Request.URL.Path,
				"error", flushErr,
			)
		}
	}
}

func shouldValidateJSONResponse(path string) bool {
	return path == "/healthz" || path == "/readyz" ||
		strings.HasPrefix(path, "/app/") ||
		strings.HasPrefix(path, "/aux/") ||
		strings.HasPrefix(path, "/bob/") ||
		strings.HasPrefix(path, "/vou/") ||
		strings.HasPrefix(path, "/wfl/") ||
		strings.HasPrefix(path, "/led/")
}

func replaceInvalidResponse(context *gin.Context, writer *bufferedResponseWriter) {
	if isBusinessPath(context.Request.URL.Path) {
		payload, _ := json.Marshal(response.Envelope{
			Code:      response.CodeInternal,
			Message:   "internal server error",
			Data:      nil,
			RequestID: response.RequestID(context),
		})
		writer.replace(http.StatusOK, "application/json; charset=utf-8", payload)
		return
	}

	payload, _ := json.Marshal(gin.H{
		"error":     "internal server error",
		"requestId": response.RequestID(context),
	})
	writer.replace(http.StatusInternalServerError, "application/json; charset=utf-8", payload)
}

func isBusinessPath(path string) bool {
	return strings.HasPrefix(path, "/app/") ||
		strings.HasPrefix(path, "/aux/") ||
		strings.HasPrefix(path, "/bob/") ||
		strings.HasPrefix(path, "/vou/") ||
		strings.HasPrefix(path, "/wfl/") ||
		strings.HasPrefix(path, "/led/")
}
