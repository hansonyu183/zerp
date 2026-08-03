DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM wfl_process_definitions definition
        JOIN wfl_definition_nodes root
          ON root.definition_id = definition.id
         AND root.id = definition.root_node_id
        WHERE definition.code = 'migration-00040-definition'
    ) THEN
        RAISE EXCEPTION 'migration 00040 did not preserve the existing definition root';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM wfl_definition_edges edge
        JOIN wfl_definition_nodes source
          ON source.definition_id = edge.definition_id
         AND source.id = edge.source_node_id
        JOIN wfl_definition_nodes target
          ON target.definition_id = edge.definition_id
         AND target.id = edge.target_node_id
        WHERE edge.id = 'E' || substring(md5('migration-00040-edge'), 1, 25)
    ) THEN
        RAISE EXCEPTION 'migration 00040 did not preserve the existing definition edge';
    END IF;

    IF (
        SELECT count(*)
        FROM pg_constraint
        WHERE conname IN (
            'wfl_definition_nodes_definition_id_id_uq',
            'wfl_definition_edges_source_node_fk',
            'wfl_definition_edges_target_node_fk',
            'wfl_process_definitions_root_node_fk'
        )
          AND convalidated
    ) <> 4 THEN
        RAISE EXCEPTION 'migration 00040 graph constraints are incomplete';
    END IF;
END
$$;
