package acc

type CreateBookInput struct {
	Name           string
	Description    string
	StartMonth     string
	BaseCurrency   string
	QueryUserIDs   []string
	OperateUserIDs []string
}

type SaveBookInput struct {
	BookID         string
	Name           string
	Description    string
	BaseCurrency   string
	Revision       int64
	QueryUserIDs   []string
	OperateUserIDs []string
}

type QueryBooksInput struct {
	Page     int
	PageSize int
	Keyword  string
}

type BookView struct {
	ID             string   `json:"bookId"`
	Code           string   `json:"code"`
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	StartMonth     string   `json:"startMonth"`
	BaseCurrency   string   `json:"baseCurrency"`
	ControlBook    bool     `json:"controlBook"`
	Revision       int64    `json:"revision"`
	QueryUserIDs   []string `json:"queryUserIds"`
	OperateUserIDs []string `json:"operateUserIds"`
}

type BookPage struct {
	Items    []BookView `json:"items"`
	Total    int64      `json:"total"`
	Page     int        `json:"page"`
	PageSize int        `json:"pageSize"`
}
