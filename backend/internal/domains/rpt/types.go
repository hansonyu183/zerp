package rpt

import "github.com/hansonyu183/zerp/backend/internal/api/generated"

type Page struct {
	Items    any   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"pageSize"`
}

type DefinitionView struct {
	DefinitionID     string                   `json:"definitionId"`
	Code             string                   `json:"code"`
	Name             string                   `json:"name"`
	Description      string                   `json:"description"`
	Enabled          bool                     `json:"enabled"`
	EverApproved     bool                     `json:"everApproved"`
	CurrentVersionID string                   `json:"currentVersionId,omitempty"`
	Revision         int64                    `json:"revision"`
	VersionID        string                   `json:"versionId,omitempty"`
	VersionNo        int32                    `json:"versionNo,omitempty"`
	Status           string                   `json:"status,omitempty"`
	Validity         string                   `json:"validity,omitempty"`
	VersionRevision  int64                    `json:"versionRevision,omitempty"`
	Data             generated.RptVersionData `json:"data"`
	CanQuery         bool                     `json:"canQuery"`
	CanExport        bool                     `json:"canExport"`
}

type MutationResult struct {
	ID       string `json:"id"`
	Status   string `json:"status,omitempty"`
	Revision int64  `json:"revision"`
}
type QueryResult struct {
	Columns  []generated.RptResultColumn `json:"columns"`
	Items    []map[string]any            `json:"items"`
	Total    int64                       `json:"total"`
	Page     int                         `json:"page"`
	PageSize int                         `json:"pageSize"`
}
type ReferenceItem struct {
	ID   string `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
}
