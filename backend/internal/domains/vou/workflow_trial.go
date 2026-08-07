package vou

// ValidateWorkflowDraft applies the same entity contract used before VOU draft persistence.
// It performs no writes and lets WFL trial a manual source without creating a document.
func (s *Service) ValidateWorkflowDraft(entity string, input DraftInput) error {
	_, err := validateDraft(entity, input)
	return err
}
