-- Definitions are stable subjects. Lifecycle/versioning belongs exclusively to
-- approval_entries; this table owns only identity, enabled and object revision.
-- name: CountWorkflowDefinitions :one
SELECT count(*)
FROM wfl_process_definitions definition
JOIN approval_entries approval ON approval.subject_id=definition.id
  AND approval.domain='wfl' AND approval.entity='process-definition'
WHERE (sqlc.arg(keyword)::text = '' OR definition.code ILIKE '%' || sqlc.arg(keyword)::text || '%' OR definition.name ILIKE '%' || sqlc.arg(keyword)::text || '%')
  AND (COALESCE(cardinality(sqlc.arg(approval_statuses)::text[]), 0) = 0 OR approval.status = ANY(sqlc.arg(approval_statuses)::text[]))
  AND (sqlc.narg(enabled)::boolean IS NULL OR definition.enabled=sqlc.narg(enabled)::boolean);

-- name: ListWorkflowDefinitions :many
SELECT definition.id,definition.code,definition.name,definition.enabled,definition.revision,
       approval.id approval_entry_id,approval.version_no,approval.status,approval.revision approval_revision,
       approval.created_by approval_created_by,approval.created_at approval_created_at,
       approval.updated_by approval_updated_by,approval.updated_at approval_updated_at,
       approval.submitted_by,approval.submitted_at,approval.approved_by,approval.approved_at,
       version.compiled,definition.updated_at
FROM wfl_process_definitions definition
JOIN approval_entries approval ON approval.subject_id=definition.id
  AND approval.domain='wfl' AND approval.entity='process-definition'
JOIN wfl_definition_versions version ON version.approval_entry_id=approval.id
WHERE (sqlc.arg(keyword)::text = '' OR definition.code ILIKE '%' || sqlc.arg(keyword)::text || '%' OR definition.name ILIKE '%' || sqlc.arg(keyword)::text || '%')
  AND (COALESCE(cardinality(sqlc.arg(approval_statuses)::text[]), 0) = 0 OR approval.status = ANY(sqlc.arg(approval_statuses)::text[]))
  AND (sqlc.narg(enabled)::boolean IS NULL OR definition.enabled=sqlc.narg(enabled)::boolean)
ORDER BY definition.updated_at DESC,definition.id DESC,approval.version_no DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: GetWorkflowDefinitionVersion :one
SELECT definition.id,definition.code,definition.name,definition.enabled,definition.revision,
       approval.id approval_entry_id,approval.version_no,approval.status,approval.revision approval_revision,
       approval.created_by approval_created_by,approval.created_at approval_created_at,
       approval.updated_by approval_updated_by,approval.updated_at approval_updated_at,
       approval.submitted_by,approval.submitted_at,approval.approved_by,approval.approved_at,
       version.script,version.diagnostic,version.compiled,version.last_trial_approval_revision,definition.updated_at
FROM wfl_process_definitions definition
JOIN approval_entries approval ON approval.subject_id=definition.id
  AND approval.domain='wfl' AND approval.entity='process-definition'
JOIN wfl_definition_versions version ON version.approval_entry_id=approval.id
WHERE definition.id=sqlc.arg(definition_id) AND approval.id=sqlc.arg(approval_entry_id);

-- name: GetWorkflowLatestApprovedVersion :one
SELECT approval.id
FROM approval_entries approval
WHERE approval.domain='wfl' AND approval.entity='process-definition'
  AND approval.subject_id=$1 AND approval.status='APPROVED'
ORDER BY approval.version_no DESC LIMIT 1;

-- name: GetWorkflowOpenVersion :one
SELECT approval.id
FROM approval_entries approval
WHERE approval.domain='wfl' AND approval.entity='process-definition'
  AND approval.subject_id=$1 AND approval.status IN ('DRAFT','PENDING')
ORDER BY approval.version_no DESC LIMIT 1;

-- name: LockWorkflowDefinition :one
SELECT id,code,name,enabled,revision FROM wfl_process_definitions WHERE id=$1 FOR UPDATE;

-- name: CreateWorkflowDefinition :exec
INSERT INTO wfl_process_definitions(id,code,name,enabled,created_by,updated_by)
VALUES($1,$2,$3,false,$4,$4);

-- name: CreateWorkflowDefinitionVersion :exec
INSERT INTO wfl_definition_versions(approval_entry_id,definition_id,script,diagnostic,compiled,last_trial_approval_revision,created_by,updated_by)
VALUES($1,$2,$3,$4,$5,NULL,$6,$6);

-- name: SaveWorkflowDefinitionVersion :execrows
UPDATE wfl_definition_versions
SET script=$1,diagnostic=$2,compiled=$3,last_trial_approval_revision=NULL,updated_at=now(),updated_by=$4
WHERE approval_entry_id=$5;

-- name: RecordWorkflowDefinitionTrial :execrows
UPDATE wfl_definition_versions SET last_trial_approval_revision=$1,updated_at=now()
WHERE approval_entry_id=$2;

-- name: SetWorkflowDefinitionEnabled :execrows
UPDATE wfl_process_definitions
SET enabled=$1,revision=revision+1,updated_at=now(),updated_by=$2
WHERE id=$3 AND revision=$4;

-- name: CountDefinitionInstances :one
SELECT count(*)
FROM wfl_definition_instances instance
WHERE instance.root_deleted_at IS NULL
  AND (sqlc.arg(definition_id)::text = '' OR instance.definition_id=sqlc.arg(definition_id)::text)
  AND (sqlc.arg(party_object_id)::text = '' OR instance.party_object_id=sqlc.arg(party_object_id)::text)
  AND (sqlc.arg(keyword)::text = '' OR instance.root_document_no ILIKE '%' || sqlc.arg(keyword)::text || '%'
       OR EXISTS (SELECT 1 FROM wfl_node_instances node WHERE node.process_id=instance.id AND node.document_no ILIKE '%' || sqlc.arg(keyword)::text || '%'));

-- name: ListDefinitionInstances :many
SELECT instance.id process_id,instance.definition_id,instance.definition_approval_entry_id,instance.definition_code,instance.definition_name,
       instance.revision,COALESCE(instance.root_document_id,'') root_document_id,instance.root_document_no,
       instance.root_entity,COALESCE(instance.party_code,'') party_code,COALESCE(instance.party_name,'') party_name,instance.updated_at
FROM wfl_definition_instances instance
WHERE instance.root_deleted_at IS NULL
  AND (sqlc.arg(definition_id)::text = '' OR instance.definition_id=sqlc.arg(definition_id)::text)
  AND (sqlc.arg(party_object_id)::text = '' OR instance.party_object_id=sqlc.arg(party_object_id)::text)
  AND (sqlc.arg(keyword)::text = '' OR instance.root_document_no ILIKE '%' || sqlc.arg(keyword)::text || '%'
       OR EXISTS (SELECT 1 FROM wfl_node_instances node WHERE node.process_id=instance.id AND node.document_no ILIKE '%' || sqlc.arg(keyword)::text || '%'))
ORDER BY instance.updated_at DESC,instance.id DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: GetDefinitionInstance :one
SELECT id process_id,definition_id,definition_code,definition_name,revision,
       COALESCE(root_document_id,'') root_document_id,root_document_no,root_entity,
       COALESCE(party_code,'') party_code,COALESCE(party_name,'') party_name,
       definition_approval_entry_id,updated_at
FROM wfl_definition_instances WHERE id=$1;

-- These order summaries are VOU read models kept here because they are shared
-- by the workflow-facing order list and the ordinary voucher list.
-- name: ListSalesOrderBaseQuantitySummaries :many
WITH ordered AS (
  SELECT line.document_id AS order_id,
         COALESCE(sum(line.base_quantity_micros), 0)::bigint AS quantity_micros
  FROM vou_product_lines line
  WHERE line.document_id = ANY(sqlc.arg(order_ids)::text[])
  GROUP BY line.document_id
), active_orders AS (
  SELECT d.id AS order_id,d.business_date,d.document_no,detail.warehouse_object_id,false AS hypothetical
  FROM vou_documents d
  JOIN vou_sale_order_details detail ON detail.document_id=d.id
  JOIN approval_entries approval ON approval.id=d.approval_entry_id
    AND approval.domain='vou' AND approval.entity=d.entity AND approval.subject_id=d.id
  WHERE approval.status='APPROVED' AND detail.fulfillment_status='OPEN' AND detail.warehouse_object_id IS NOT NULL
), target_orders AS (
  SELECT d.id AS order_id,d.business_date,d.document_no,detail.warehouse_object_id,
         NOT EXISTS (SELECT 1 FROM active_orders active WHERE active.order_id=d.id) AS hypothetical
  FROM vou_documents d JOIN vou_sale_order_details detail ON detail.document_id=d.id
  WHERE d.id=ANY(sqlc.arg(order_ids)::text[]) AND detail.warehouse_object_id IS NOT NULL
), demand_orders AS (
  SELECT * FROM active_orders
  UNION ALL SELECT target.* FROM target_orders target
  WHERE NOT EXISTS (SELECT 1 FROM active_orders active WHERE active.order_id=target.order_id)
), approved_outbound AS (
	SELECT line.source_order_line_id,sum(line.base_quantity_micros)::bigint AS quantity_micros
	FROM vou_sale_outbound_lines line JOIN vou_documents doc ON doc.id=line.document_id
  JOIN approval_entries approval ON approval.id=doc.approval_entry_id
    AND approval.domain='vou' AND approval.entity=doc.entity AND approval.subject_id=doc.id AND approval.status='APPROVED'
  GROUP BY line.source_order_line_id
), demand_lines AS (
  SELECT orders.order_id,orders.business_date,orders.document_no,orders.warehouse_object_id,orders.hypothetical,
         line.id AS order_line_id,line.line_no,line.product_object_id,
         GREATEST(line.base_quantity_micros-COALESCE(outbound.quantity_micros,0),0)::bigint AS demand_micros
  FROM demand_orders orders
  JOIN vou_product_lines line ON line.document_id=orders.order_id
  LEFT JOIN approved_outbound outbound ON outbound.source_order_line_id=line.id
), inventory AS (
  SELECT entry.warehouse_id AS warehouse_object_id,entry.product_id AS product_object_id,
         sum(entry.quantity_delta_micros)::bigint AS balance_micros
  FROM acc_inventory_entries entry JOIN acc_books book ON book.id=entry.book_id AND book.control_book
  GROUP BY entry.warehouse_id,entry.product_id
), allocated AS (
  SELECT demand.*,COALESCE(inventory.balance_micros,0)::bigint AS balance_micros,
         COALESCE(sum(demand.demand_micros) OVER (
           PARTITION BY demand.warehouse_object_id,demand.product_object_id
           ORDER BY demand.hypothetical,demand.business_date,demand.document_no,demand.order_id,demand.line_no
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ),0)::bigint AS prior_demand_micros
  FROM demand_lines demand LEFT JOIN inventory USING (warehouse_object_id,product_object_id)
), shortage AS (
  SELECT order_id,COALESCE(sum(
    GREATEST(demand_micros-GREATEST(balance_micros-prior_demand_micros,0),0)
  ),0)::bigint AS shortage_quantity_micros
  FROM allocated WHERE order_id=ANY(sqlc.arg(order_ids)::text[]) GROUP BY order_id
), outbound AS (
  SELECT detail.source_order_id AS order_id,
		 COALESCE(sum(line.base_quantity_micros),0)::bigint AS quantity_micros
  FROM vou_sale_outbound_details detail
  JOIN vou_documents doc ON doc.id=detail.document_id
  JOIN approval_entries approval ON approval.id=doc.approval_entry_id
    AND approval.domain='vou' AND approval.entity=doc.entity AND approval.subject_id=doc.id AND approval.status='APPROVED'
  JOIN vou_sale_outbound_lines line ON line.document_id=detail.document_id
  JOIN vou_product_lines source ON source.id=line.source_order_line_id
  WHERE detail.source_order_id=ANY(sqlc.arg(order_ids)::text[]) GROUP BY detail.source_order_id
), signoff AS (
  SELECT detail.source_order_id AS order_id,
		 COALESCE(sum(line.signed_base_quantity_micros),0)::bigint AS signed_micros,
		 COALESCE(sum(line.signed_base_quantity_micros+line.rejected_base_quantity_micros+line.loss_base_quantity_micros),0)::bigint AS resolved_micros
  FROM vou_sale_signoff_details detail
  JOIN vou_documents doc ON doc.id=detail.document_id
  JOIN approval_entries approval ON approval.id=doc.approval_entry_id
    AND approval.domain='vou' AND approval.entity=doc.entity AND approval.subject_id=doc.id AND approval.status='APPROVED'
  JOIN vou_sale_signoff_lines line ON line.document_id=detail.document_id
  JOIN vou_product_lines source ON source.id=line.source_order_line_id
  WHERE detail.source_order_id=ANY(sqlc.arg(order_ids)::text[]) GROUP BY detail.source_order_id
), returns AS (
  SELECT detail.source_order_id AS order_id,
		 COALESCE(sum(line.base_quantity_micros),0)::bigint AS quantity_micros
  FROM vou_sale_return_details detail
  JOIN vou_documents doc ON doc.id=detail.document_id
  JOIN approval_entries approval ON approval.id=doc.approval_entry_id
    AND approval.domain='vou' AND approval.entity=doc.entity AND approval.subject_id=doc.id AND approval.status='APPROVED'
  JOIN vou_sale_return_lines line ON line.document_id=detail.document_id
  JOIN vou_sale_signoff_lines signoff_line ON signoff_line.id=line.source_signoff_line_id
  JOIN vou_product_lines source ON source.id=signoff_line.source_order_line_id
  WHERE detail.source_order_id=ANY(sqlc.arg(order_ids)::text[]) AND detail.return_kind='AFTER_SALE'
  GROUP BY detail.source_order_id
)
SELECT d.id AS order_id,(detail.warehouse_object_id IS NOT NULL)::boolean AS warehouse_available,
       COALESCE(shortage.shortage_quantity_micros,0)::bigint AS shortage_base_quantity_micros,
       COALESCE(ordered.quantity_micros,0)::bigint AS ordered_base_quantity_micros,
       COALESCE(outbound.quantity_micros,0)::bigint AS outbound_base_quantity_micros,
       GREATEST(COALESCE(outbound.quantity_micros,0)-COALESCE(signoff.resolved_micros,0),0)::bigint AS in_transit_base_quantity_micros,
       COALESCE(signoff.signed_micros,0)::bigint AS signed_base_quantity_micros,
       GREATEST(COALESCE(signoff.signed_micros,0)-COALESCE(returns.quantity_micros,0),0)::bigint AS net_signed_base_quantity_micros
FROM vou_documents d JOIN vou_sale_order_details detail ON detail.document_id=d.id
LEFT JOIN ordered ON ordered.order_id=d.id LEFT JOIN shortage ON shortage.order_id=d.id
LEFT JOIN outbound ON outbound.order_id=d.id LEFT JOIN signoff ON signoff.order_id=d.id
LEFT JOIN returns ON returns.order_id=d.id
WHERE d.id=ANY(sqlc.arg(order_ids)::text[]) ORDER BY d.id;

-- name: ListPurchaseOrderBaseQuantitySummaries :many
WITH ordered AS (
  SELECT line.document_id AS order_id,
         COALESCE(sum(line.base_quantity_micros),0)::bigint AS quantity_micros
  FROM vou_product_lines line
  WHERE line.document_id=ANY(sqlc.arg(order_ids)::text[])
  GROUP BY line.document_id
), inbound AS (
  SELECT detail.source_order_id AS order_id,
		 COALESCE(sum(line.base_quantity_micros),0)::bigint AS quantity_micros
  FROM vou_purchase_inbound_details detail
  JOIN vou_documents doc ON doc.id=detail.document_id
  JOIN approval_entries approval ON approval.id=doc.approval_entry_id
    AND approval.domain='vou' AND approval.entity=doc.entity AND approval.subject_id=doc.id AND approval.status='APPROVED'
  JOIN vou_purchase_inbound_lines line ON line.document_id=detail.document_id
  JOIN vou_product_lines source ON source.id=line.source_order_line_id
  WHERE detail.source_order_id=ANY(sqlc.arg(order_ids)::text[]) GROUP BY detail.source_order_id
), returns AS (
  SELECT detail.source_order_id AS order_id,
		 COALESCE(sum(line.base_quantity_micros) FILTER (WHERE approval.status<>'APPROVED'),0)::bigint AS processing_micros,
		 COALESCE(sum(line.base_quantity_micros) FILTER (WHERE approval.status='APPROVED'),0)::bigint AS approved_micros
  FROM vou_purchase_return_details detail JOIN vou_documents doc ON doc.id=detail.document_id
  JOIN approval_entries approval ON approval.id=doc.approval_entry_id
    AND approval.domain='vou' AND approval.entity=doc.entity AND approval.subject_id=doc.id
  JOIN vou_purchase_return_lines line ON line.document_id=detail.document_id
  JOIN vou_product_lines source ON source.id=line.source_order_line_id
  WHERE detail.source_order_id=ANY(sqlc.arg(order_ids)::text[]) GROUP BY detail.source_order_id
)
SELECT d.id AS order_id,
       COALESCE(ordered.quantity_micros,0)::bigint AS ordered_base_quantity_micros,
       COALESCE(inbound.quantity_micros,0)::bigint AS inbound_base_quantity_micros,
       COALESCE(returns.processing_micros,0)::bigint AS return_processing_base_quantity_micros,
       GREATEST(COALESCE(inbound.quantity_micros,0)-COALESCE(returns.approved_micros,0),0)::bigint AS net_inbound_base_quantity_micros
FROM vou_documents d LEFT JOIN ordered ON ordered.order_id=d.id
LEFT JOIN inbound ON inbound.order_id=d.id LEFT JOIN returns ON returns.order_id=d.id
WHERE d.id=ANY(sqlc.arg(order_ids)::text[]) ORDER BY d.id;

-- name: RecordWorkflowTrialAudit :exec
INSERT INTO wfl_runtime_audit_events(id,definition_id,definition_approval_entry_id,event_type,document_id,actor_id,request_id,summary)
VALUES(sqlc.arg(id),sqlc.arg(definition_id),sqlc.arg(definition_approval_entry_id),'TRIAL',sqlc.arg(document_id),sqlc.arg(actor_id),sqlc.arg(request_id),sqlc.arg(summary));

-- name: WorkflowDefinitionHasInstances :one
SELECT EXISTS(SELECT 1 FROM wfl_definition_instances WHERE definition_id=$1);

-- name: DeleteWorkflowDefinition :exec
DELETE FROM wfl_process_definitions WHERE id=$1;

-- name: UpsertWorkflowDefinitionPermission :exec
INSERT INTO app_permissions(id,path,domain,entity,action,description,status,created_by,updated_by)
VALUES(sqlc.arg(id),sqlc.arg(path),'wfl',sqlc.arg(entity),sqlc.arg(action),sqlc.arg(description),'ENABLED',sqlc.arg(actor_id),sqlc.arg(actor_id))
ON CONFLICT(path) DO UPDATE SET description=excluded.description,status='ENABLED',revision=app_permissions.revision+1,updated_at=now(),updated_by=excluded.updated_by;

-- name: ListWorkflowInstanceNodes :many
SELECT node.id,node.parent_node_instance_id,node.node_key,node.node_name,
       COALESCE(node.document_id,'') document_id,node.document_no,node.document_entity,COALESCE(approval.status,'') document_status,
       COALESCE(approval.revision,0) document_revision,COALESCE(to_char(document.business_date,'YYYY-MM-DD'),'')::text business_date,
       COALESCE(node.business_parent_entity,'') business_parent_entity,COALESCE(node.business_parent_document_id,'') business_parent_document_id,
       COALESCE(node.relation_name,'') relation_name,node.trigger_event,COALESCE(node.action_name,'') action_name,node.evaluated_at
FROM wfl_node_instances node
LEFT JOIN vou_documents document ON document.id=node.document_id
LEFT JOIN approval_entries approval ON approval.id=document.approval_entry_id
  AND approval.domain='vou' AND approval.entity=document.entity AND approval.subject_id=document.id
WHERE node.process_id=$1 ORDER BY node.created_at,node.id;

-- name: ListCompletedWorkflowActionTargets :many
SELECT execution.source_node_instance_id,execution.target_node_key
FROM wfl_action_executions execution
JOIN wfl_node_instances node ON node.id=execution.target_node_instance_id AND node.document_id IS NOT NULL
WHERE execution.process_id=$1;

-- name: CountWorkflowRuntimeAudits :one
SELECT count(*) FROM wfl_runtime_audit_events WHERE process_id=$1;

-- name: ListWorkflowRuntimeAudits :many
SELECT id,event_type,node_instance_id,document_id,document_no,actor_id,request_id,summary,occurred_at
FROM wfl_runtime_audit_events WHERE process_id=sqlc.arg(process_id)
ORDER BY occurred_at DESC,id DESC LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: ListEnabledWorkflowDefinitionsForShare :many
SELECT definition.id,definition.code,definition.name,approval.id approval_entry_id,version.script
FROM wfl_process_definitions definition
JOIN approval_entries approval ON approval.subject_id=definition.id
  AND approval.domain='wfl' AND approval.entity='process-definition' AND approval.status='APPROVED'
JOIN wfl_definition_versions version ON version.approval_entry_id=approval.id
WHERE definition.enabled
  AND NOT EXISTS (
    SELECT 1 FROM approval_entries newer
    WHERE newer.domain=approval.domain AND newer.entity=approval.entity
      AND newer.subject_id=approval.subject_id AND newer.status='APPROVED'
      AND newer.version_no > approval.version_no
  )
ORDER BY definition.id FOR SHARE OF definition;

-- name: LockWorkflowRootInstance :one
SELECT instance.id process_id,node.id node_id
FROM wfl_definition_instances instance
JOIN wfl_node_instances node ON node.process_id=instance.id AND node.parent_node_instance_id IS NULL
WHERE instance.definition_id=sqlc.arg(definition_id) AND instance.root_document_id=sqlc.arg(root_document_id)
FOR UPDATE OF instance,node;

-- name: WorkflowDocumentHasRootInstance :one
SELECT EXISTS(
    SELECT 1
    FROM wfl_definition_instances instance
    WHERE instance.root_document_id=sqlc.arg(document_id)
);

-- name: CreateWorkflowDefinitionInstance :exec
INSERT INTO wfl_definition_instances(id,definition_id,root_document_id,root_document_no,root_entity,definition_code,definition_name,party_object_id,party_code,party_name,definition_approval_entry_id,created_by,updated_by)
VALUES(sqlc.arg(id),sqlc.arg(definition_id),sqlc.arg(root_document_id),sqlc.arg(root_document_no),sqlc.arg(root_entity),sqlc.arg(definition_code),sqlc.arg(definition_name),sqlc.narg(party_object_id),sqlc.narg(party_code),sqlc.narg(party_name),sqlc.arg(definition_approval_entry_id),sqlc.arg(actor_id),sqlc.arg(actor_id));

-- name: CreateWorkflowRootNodeInstance :exec
INSERT INTO wfl_node_instances(id,process_id,node_key,node_name,document_id,document_no,document_entity,trigger_event)
VALUES(sqlc.arg(id),sqlc.arg(process_id),sqlc.arg(node_key),sqlc.arg(node_name),sqlc.arg(document_id),sqlc.arg(document_no),sqlc.arg(document_entity),'APPROVED');

-- name: LockWorkflowNodesForDocument :many
SELECT node.id,node.process_id,node.node_key,instance.definition_id,instance.definition_approval_entry_id
FROM wfl_node_instances node JOIN wfl_definition_instances instance ON instance.id=node.process_id
WHERE node.document_id=$1 FOR UPDATE OF node,instance;

-- name: GetWorkflowNodeDocumentEntity :one
SELECT document_entity FROM wfl_node_instances WHERE id=$1;

-- name: LockWorkflowActionExecution :one
SELECT execution.id,execution.target_node_instance_id,node.document_id,execution.action_fingerprint
FROM wfl_action_executions execution LEFT JOIN wfl_node_instances node ON node.id=execution.target_node_instance_id
WHERE execution.process_id=sqlc.arg(process_id)
  AND execution.source_node_instance_id=sqlc.arg(source_node_instance_id)
  AND execution.target_node_key=sqlc.arg(target_node_key)
  AND execution.relation_name=sqlc.arg(relation_name)
FOR UPDATE OF execution;

-- name: LockWorkflowNodeByProcessAndDocument :one
SELECT id,node_key,COALESCE(parent_node_instance_id,'') parent_node_instance_id,COALESCE(relation_name,'') relation_name
FROM wfl_node_instances WHERE process_id=sqlc.arg(process_id) AND document_id=sqlc.arg(document_id) FOR UPDATE;

-- name: RestoreWorkflowNodeInstance :exec
UPDATE wfl_node_instances SET document_id=sqlc.arg(document_id),document_no=sqlc.arg(document_no),document_entity=sqlc.arg(document_entity),business_parent_entity=sqlc.arg(business_parent_entity),business_parent_document_id=sqlc.arg(business_parent_document_id),relation_name=sqlc.arg(relation_name),trigger_event='ACTION',action_name=sqlc.arg(action_name),evaluated_at=NULL WHERE id=sqlc.arg(id);

-- name: CreateWorkflowActionNodeInstance :exec
INSERT INTO wfl_node_instances(id,process_id,parent_node_instance_id,node_key,node_name,document_id,document_no,document_entity,business_parent_entity,business_parent_document_id,relation_name,trigger_event,action_name)
VALUES(sqlc.arg(id),sqlc.arg(process_id),sqlc.arg(parent_node_instance_id),sqlc.arg(node_key),sqlc.arg(node_name),sqlc.arg(document_id),sqlc.arg(document_no),sqlc.arg(document_entity),sqlc.arg(business_parent_entity),sqlc.arg(business_parent_document_id),sqlc.arg(relation_name),'ACTION',sqlc.arg(action_name));

-- name: RestoreWorkflowActionExecution :exec
UPDATE wfl_action_executions
SET target_node_instance_id=sqlc.arg(target_node_instance_id),
    action_fingerprint=sqlc.arg(action_fingerprint),executed_at=now()
WHERE id=sqlc.arg(id);

-- name: CreateWorkflowActionExecution :exec
INSERT INTO wfl_action_executions(id,process_id,source_node_instance_id,target_node_key,relation_name,action_name,action_fingerprint,target_node_instance_id)
VALUES(sqlc.arg(id),sqlc.arg(process_id),sqlc.arg(source_node_instance_id),sqlc.arg(target_node_key),sqlc.arg(relation_name),sqlc.arg(action_name),sqlc.arg(action_fingerprint),sqlc.arg(target_node_instance_id));

-- name: MarkWorkflowNodeEvaluated :exec
UPDATE wfl_node_instances SET evaluated_at=now() WHERE id=$1;

-- name: AcquireWorkflowCreateChildLock :exec
SELECT pg_advisory_xact_lock(hashtextextended($1,0));

-- name: LockWorkflowCreateChildRequest :one
SELECT process_id,parent_node_instance_id,target_node_key,action_execution_id
FROM wfl_create_child_requests WHERE definition_id=sqlc.arg(definition_id) AND request_key=sqlc.arg(request_key) FOR UPDATE;

-- name: GetWorkflowCreateChildExecutionResult :one
SELECT node.document_entity,COALESCE(node.document_id,'') document_id,node.document_no
FROM wfl_action_executions execution JOIN wfl_node_instances node ON node.id=execution.target_node_instance_id
WHERE execution.id=$1;

-- name: LockWorkflowCreateChildSourceNode :one
SELECT node.node_key,node.document_entity,node.document_id,instance.definition_approval_entry_id
FROM wfl_definition_instances instance JOIN wfl_node_instances node ON node.process_id=instance.id
WHERE instance.id=sqlc.arg(process_id) AND instance.definition_id=sqlc.arg(definition_id) AND node.id=sqlc.arg(node_id) AND node.document_id IS NOT NULL
FOR UPDATE OF instance,node;

-- name: CreateWorkflowCreateChildRequest :exec
INSERT INTO wfl_create_child_requests(definition_id,request_key,process_id,parent_node_instance_id,target_node_key)
VALUES(sqlc.arg(definition_id),sqlc.arg(request_key),sqlc.arg(process_id),sqlc.arg(parent_node_instance_id),sqlc.arg(target_node_key));

-- name: GetWorkflowActionExecutionResult :one
SELECT execution.id,node.document_entity,COALESCE(node.document_id,'') document_id,node.document_no
FROM wfl_action_executions execution JOIN wfl_node_instances node ON node.id=execution.target_node_instance_id
WHERE execution.process_id=sqlc.arg(process_id) AND execution.source_node_instance_id=sqlc.arg(source_node_instance_id) AND execution.target_node_key=sqlc.arg(target_node_key);

-- name: SetWorkflowCreateChildRequestExecution :exec
UPDATE wfl_create_child_requests SET action_execution_id=sqlc.arg(action_execution_id)
WHERE definition_id=sqlc.arg(definition_id) AND request_key=sqlc.arg(request_key);

-- name: MarkWorkflowRootDocumentDeleted :exec
UPDATE wfl_definition_instances SET root_deleted_at=now(),root_document_id=NULL,updated_at=now(),updated_by=sqlc.arg(actor_id)
WHERE root_document_id=sqlc.arg(document_id);

-- name: ClearWorkflowNodeDocument :exec
UPDATE wfl_node_instances SET document_id=NULL WHERE document_id=$1;

-- name: GetWorkflowInstanceDefinition :one
SELECT definition_id,definition_approval_entry_id FROM wfl_definition_instances WHERE id=$1;

-- name: CreateWorkflowRuntimeAudit :exec
INSERT INTO wfl_runtime_audit_events(id,process_id,definition_id,definition_approval_entry_id,event_type,node_instance_id,document_id,document_no,actor_id,request_id,summary)
VALUES(sqlc.arg(id),sqlc.narg(process_id),sqlc.arg(definition_id),sqlc.arg(definition_approval_entry_id),sqlc.arg(event_type),sqlc.narg(node_instance_id),sqlc.narg(document_id),sqlc.narg(document_no),sqlc.arg(actor_id),sqlc.arg(request_id),sqlc.arg(summary));
