-- +goose Up

-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM wfl_process_definitions definition
        LEFT JOIN wfl_definition_nodes root
          ON root.id = definition.root_node_id
         AND root.definition_id = definition.id
        WHERE root.id IS NULL
        UNION ALL
        SELECT 1
        FROM wfl_definition_edges edge
        LEFT JOIN wfl_definition_nodes source
          ON source.id = edge.source_node_id
         AND source.definition_id = edge.definition_id
        LEFT JOIN wfl_definition_nodes target
          ON target.id = edge.target_node_id
         AND target.definition_id = edge.definition_id
        WHERE source.id IS NULL OR target.id IS NULL
    ) THEN
        RAISE EXCEPTION 'cannot enforce WFL graph integrity while cross-definition references exist';
    END IF;
END
$$;
-- +goose StatementEnd

ALTER TABLE wfl_definition_nodes
    ADD CONSTRAINT wfl_definition_nodes_definition_id_id_uq UNIQUE (definition_id, id);

ALTER TABLE wfl_definition_edges
    DROP CONSTRAINT wfl_definition_edges_source_node_id_fkey,
    DROP CONSTRAINT wfl_definition_edges_target_node_id_fkey,
    ADD CONSTRAINT wfl_definition_edges_source_node_fk
        FOREIGN KEY (definition_id, source_node_id)
        REFERENCES wfl_definition_nodes(definition_id, id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT wfl_definition_edges_target_node_fk
        FOREIGN KEY (definition_id, target_node_id)
        REFERENCES wfl_definition_nodes(definition_id, id)
        ON DELETE RESTRICT;

ALTER TABLE wfl_process_definitions
    ADD CONSTRAINT wfl_process_definitions_root_node_fk
        FOREIGN KEY (id, root_node_id)
        REFERENCES wfl_definition_nodes(definition_id, id)
        ON DELETE NO ACTION
        DEFERRABLE INITIALLY DEFERRED;

-- +goose Down

ALTER TABLE wfl_process_definitions
    DROP CONSTRAINT wfl_process_definitions_root_node_fk;

ALTER TABLE wfl_definition_edges
    DROP CONSTRAINT wfl_definition_edges_source_node_fk,
    DROP CONSTRAINT wfl_definition_edges_target_node_fk,
    ADD CONSTRAINT wfl_definition_edges_source_node_id_fkey
        FOREIGN KEY (source_node_id) REFERENCES wfl_definition_nodes(id) ON DELETE RESTRICT,
    ADD CONSTRAINT wfl_definition_edges_target_node_id_fkey
        FOREIGN KEY (target_node_id) REFERENCES wfl_definition_nodes(id) ON DELETE RESTRICT;

ALTER TABLE wfl_definition_nodes
    DROP CONSTRAINT wfl_definition_nodes_definition_id_id_uq;
