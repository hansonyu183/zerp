package bob

func versionNumber(value *int32) int32 {
	if value == nil {
		return 0
	}
	return *value
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
