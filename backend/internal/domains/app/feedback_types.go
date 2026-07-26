package app

import "time"

const (
	FeedbackCategoryBug        = "BUG"
	FeedbackCategorySuggestion = "SUGGESTION"
	FeedbackCategoryOther      = "OTHER"

	FeedbackStatusPending    = "PENDING"
	FeedbackStatusProcessing = "PROCESSING"
	FeedbackStatusPublished  = "PUBLISHED"
	FeedbackStatusFailed     = "FAILED"
)

type CreateFeedbackInput struct {
	Category         string   `json:"category"`
	Title            string   `json:"title"`
	Content          string   `json:"content"`
	PagePath         string   `json:"pagePath"`
	ClientVersion    string   `json:"clientVersion"`
	RelatedRequestID string   `json:"relatedRequestId"`
	AttachmentIDs    []string `json:"attachmentIds"`
}

type GetFeedbackInput struct {
	FeedbackID string `json:"feedbackId"`
}

type FeedbackAttachmentInitiateInput struct {
	FileName    string `json:"fileName"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
	SHA256      string `json:"sha256"`
}

type FeedbackAttachmentInitiateResult struct {
	FileID    string    `json:"fileId"`
	UploadURL string    `json:"uploadUrl"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type FeedbackAttachmentRemoveInput struct {
	FileID string `json:"fileId"`
}

type FeedbackCreatedView struct {
	FeedbackID  string    `json:"feedbackId"`
	Status      string    `json:"status"`
	SubmittedAt time.Time `json:"submittedAt"`
}

type FeedbackView struct {
	FeedbackID  string     `json:"feedbackId"`
	Category    string     `json:"category"`
	Title       string     `json:"title"`
	Status      string     `json:"status"`
	IssueURL    *string    `json:"issueUrl"`
	SubmittedAt time.Time  `json:"submittedAt"`
	PublishedAt *time.Time `json:"publishedAt"`
}
