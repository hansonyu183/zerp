INSERT INTO wfl_process_definitions (
    id,
    code,
    name,
    status,
    root_node_id,
    created_by,
    updated_by
) VALUES (
    'D' || substring(md5('migration-00040-definition'), 1, 25),
    'migration-00040-definition',
    '迁移升级验证流程',
    'DRAFT',
    'N' || substring(md5('migration-00040-root'), 1, 25),
    '01JAPPSYST3MACTR0000000000',
    '01JAPPSYST3MACTR0000000000'
);

INSERT INTO wfl_definition_nodes (
    id,
    definition_id,
    node_key,
    name,
    document_entity
) VALUES
    (
        'N' || substring(md5('migration-00040-root'), 1, 25),
        'D' || substring(md5('migration-00040-definition'), 1, 25),
        'root',
        '根节点',
        'sale-order'
    ),
    (
        'N' || substring(md5('migration-00040-target'), 1, 25),
        'D' || substring(md5('migration-00040-definition'), 1, 25),
        'target',
        '目标节点',
        'sale-outbound'
    );

INSERT INTO wfl_definition_edges (
    id,
    definition_id,
    source_node_id,
    target_node_id,
    converter_key
) VALUES (
    'E' || substring(md5('migration-00040-edge'), 1, 25),
    'D' || substring(md5('migration-00040-definition'), 1, 25),
    'N' || substring(md5('migration-00040-root'), 1, 25),
    'N' || substring(md5('migration-00040-target'), 1, 25),
    'copy'
);
