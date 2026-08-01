package systemidentity

const (
	UserID          = "01JAPPSYST3MACTR0000000000"
	RoleID          = "01JAPPSYST3MR0X30000000000"
	Username        = "system"
	UserDisplayName = "系统用户"
	RoleCode        = "system"
	RoleName        = "系统角色"
)

func IsUser(id string) bool { return id == UserID }

func IsRole(id string) bool { return id == RoleID }
