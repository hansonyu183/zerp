package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/requestbody"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
)

func (h *Handler) signin(c *gin.Context) {
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := requestbody.DecodeJSON(c, &input); err != nil {
		h.writeError(c, domainError(ErrorValidation, "invalid request", err))
		return
	}
	result, err := h.service.Signin(c.Request.Context(), input.Username, input.Password, response.RequestID(c))
	if err != nil {
		h.writeError(c, err)
		return
	}
	h.setSessionCookie(c, result.SessionToken, result.ExpiresAt)
	response.OK(c, result.Data)
}

func (h *Handler) session(c *gin.Context) {
	if err := requestbody.DecodeEmptyObject(c); err != nil {
		h.writeError(c, domainError(ErrorValidation, "request body must be an empty object", err))
		return
	}
	result, err := h.service.RestoreSession(c.Request.Context(), currentPrincipal(c))
	if err != nil {
		if errorIsKind(err, ErrorUnauthenticated) {
			h.clearSessionCookie(c)
		}
		h.writeError(c, err)
		return
	}
	response.OK(c, result.Data)
}

func (h *Handler) signout(c *gin.Context) {
	if err := requestbody.DecodeEmptyObject(c); err != nil {
		h.writeError(c, domainError(ErrorValidation, "request body must be an empty object", err))
		return
	}
	if err := h.service.Signout(c.Request.Context(), currentPrincipal(c), response.RequestID(c)); err != nil {
		h.writeError(c, err)
		return
	}
	h.clearSessionCookie(c)
	response.OK(c, map[string]any{})
}

func (h *Handler) profile(c *gin.Context) {
	var request struct {
		DisplayName json.RawMessage `json:"displayName"`
		AvatarURL   json.RawMessage `json:"avatarUrl"`
	}
	if err := requestbody.DecodeJSON(c, &request); err != nil {
		h.writeError(c, domainError(ErrorValidation, "invalid request", err))
		return
	}
	principal := currentPrincipal(c)
	if len(request.DisplayName) == 0 && len(request.AvatarURL) == 0 {
		result, err := h.service.GetProfile(c.Request.Context(), principal.User.ID)
		h.result(c, result, err)
		return
	}
	if len(request.DisplayName) == 0 ||
		bytes.Equal(bytes.TrimSpace(request.DisplayName), []byte("null")) {
		h.writeError(c, domainError(ErrorValidation, "display name is required", nil))
		return
	}
	var displayName string
	if err := json.Unmarshal(request.DisplayName, &displayName); err != nil {
		h.writeError(c, domainError(ErrorValidation, "invalid display name", err))
		return
	}
	var avatarURL *string
	if len(request.AvatarURL) > 0 &&
		!bytes.Equal(bytes.TrimSpace(request.AvatarURL), []byte("null")) {
		var value string
		if err := json.Unmarshal(request.AvatarURL, &value); err != nil {
			h.writeError(c, domainError(ErrorValidation, "invalid avatar URL", err))
			return
		}
		avatarURL = &value
	}
	result, err := h.service.SaveProfile(
		c.Request.Context(),
		principal.User.ID,
		SaveProfileInput{DisplayName: displayName, AvatarURL: avatarURL},
		response.RequestID(c),
	)
	h.result(c, result, err)
}

func (h *Handler) changePassword(c *gin.Context) {
	var input ChangePasswordInput
	if !h.bind(c, &input) {
		return
	}
	principal := currentPrincipal(c)
	if err := h.service.ChangePassword(c.Request.Context(), principal, input, response.RequestID(c)); err != nil {
		h.writeError(c, err)
		return
	}
	h.clearSessionCookie(c)
	response.OK(c, map[string]any{})
}

func (h *Handler) setSessionCookie(c *gin.Context, value string, expiresAt time.Time) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name: h.cfg.SessionCookieName, Value: value, Path: "/", Expires: expiresAt,
		MaxAge: int(time.Until(expiresAt).Seconds()), HttpOnly: true, Secure: h.cfg.SessionCookieSecure, SameSite: h.cookieSameSite(),
	})
}

func (h *Handler) clearSessionCookie(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name: h.cfg.SessionCookieName, Value: "", Path: "/", Expires: time.Unix(1, 0),
		MaxAge: -1, HttpOnly: true, Secure: h.cfg.SessionCookieSecure, SameSite: h.cookieSameSite(),
	})
}

func (h *Handler) cookieSameSite() http.SameSite {
	switch h.cfg.SessionCookieSameSite {
	case "strict":
		return http.SameSiteStrictMode
	case "none":
		return http.SameSiteNoneMode
	default:
		return http.SameSiteLaxMode
	}
}
