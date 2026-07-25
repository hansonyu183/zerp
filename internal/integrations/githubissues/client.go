package githubissues

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	appdomain "github.com/hansonyu183/zerp-back/internal/domains/app"
)

const (
	defaultAPIBase = "https://api.github.com"
	maxBodyBytes   = 1 << 20
)

type Client struct {
	httpClient *http.Client
	apiBase    string
	repository string
	token      string
}

type APIError struct {
	status     int
	code       string
	retryable  bool
	retryAfter time.Duration
	cause      error
}

func (e *APIError) Error() string {
	if e.status > 0 {
		return fmt.Sprintf("github issues request failed with status %d", e.status)
	}
	return "github issues request failed"
}

func (e *APIError) Unwrap() error             { return e.cause }
func (e *APIError) Retryable() bool           { return e.retryable }
func (e *APIError) RetryAfter() time.Duration { return e.retryAfter }
func (e *APIError) ErrorCode() string         { return e.code }

func New(repository, token string) (*Client, error) {
	if strings.TrimSpace(repository) == "" || strings.TrimSpace(token) == "" {
		return nil, errors.New("GitHub repository and token are required")
	}
	return &Client{
		httpClient: &http.Client{Timeout: 10 * time.Second},
		apiBase:    defaultAPIBase, repository: repository, token: token,
	}, nil
}

func (c *Client) FindByMarker(ctx context.Context, marker string) (appdomain.FeedbackIssue, bool, error) {
	query := fmt.Sprintf("repo:%s type:issue in:body %q", c.repository, markerText(marker))
	endpoint := c.apiBase + "/search/issues?q=" + url.QueryEscape(query) + "&per_page=5"
	var result struct {
		Items []struct {
			Number  int64  `json:"number"`
			HTMLURL string `json:"html_url"`
		} `json:"items"`
	}
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &result); err != nil {
		return appdomain.FeedbackIssue{}, false, err
	}
	if len(result.Items) == 0 {
		return appdomain.FeedbackIssue{}, false, nil
	}
	return appdomain.FeedbackIssue{Number: result.Items[0].Number, URL: result.Items[0].HTMLURL}, true, nil
}

func (c *Client) Create(
	ctx context.Context,
	title, body string,
	labels []string,
) (appdomain.FeedbackIssue, error) {
	payload := struct {
		Title  string   `json:"title"`
		Body   string   `json:"body"`
		Labels []string `json:"labels"`
	}{Title: title, Body: body, Labels: labels}
	var result struct {
		Number  int64  `json:"number"`
		HTMLURL string `json:"html_url"`
	}
	endpoint := fmt.Sprintf("%s/repos/%s/issues", c.apiBase, c.repository)
	if err := c.doJSON(ctx, http.MethodPost, endpoint, payload, &result); err != nil {
		return appdomain.FeedbackIssue{}, err
	}
	if result.Number <= 0 || result.HTMLURL == "" {
		return appdomain.FeedbackIssue{}, &APIError{code: "invalid_response", retryable: true}
	}
	return appdomain.FeedbackIssue{Number: result.Number, URL: result.HTMLURL}, nil
}

func (c *Client) doJSON(ctx context.Context, method, endpoint string, payload, result any) error {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return &APIError{code: "encode", retryable: false, cause: err}
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return &APIError{code: "request", retryable: false, cause: err}
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("Authorization", "Bearer "+c.token)
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	request.Header.Set("User-Agent", "zerp-back-feedback")
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := c.httpClient.Do(request)
	if err != nil {
		return &APIError{code: "network", retryable: true, cause: err}
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, maxBodyBytes))
		return responseError(response)
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, maxBodyBytes)).Decode(result); err != nil {
		return &APIError{code: "decode", retryable: true, cause: err}
	}
	return nil
}

func responseError(response *http.Response) error {
	retryAfter := parseRetryAfter(response.Header.Get("Retry-After"))
	rateLimited := response.StatusCode == http.StatusTooManyRequests ||
		(response.StatusCode == http.StatusForbidden &&
			(response.Header.Get("X-RateLimit-Remaining") == "0" || retryAfter > 0))
	retryable := response.StatusCode == http.StatusRequestTimeout ||
		response.StatusCode >= http.StatusInternalServerError || rateLimited
	code := "http_" + strconv.Itoa(response.StatusCode)
	if rateLimited {
		code = "rate_limit"
	}
	return &APIError{
		status: response.StatusCode, code: code, retryable: retryable, retryAfter: retryAfter,
	}
}

func parseRetryAfter(value string) time.Duration {
	value = strings.TrimSpace(value)
	if seconds, err := strconv.Atoi(value); err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}
	if instant, err := http.ParseTime(value); err == nil {
		if delay := time.Until(instant); delay > 0 {
			return delay
		}
	}
	return 0
}

func markerText(marker string) string {
	return strings.TrimSuffix(strings.TrimPrefix(marker, "<!-- "), " -->")
}
