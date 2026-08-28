/**
 * This file was auto-generated from the bundled OpenAPI contract.
 * Do not make direct changes to the file.
 */

import type * as Models from './index'

export interface paths {
  "/acc/book/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BookQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.BookPageEnvelope } } };
    };
  };
  "/acc/book/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BookGetRequest } };
      responses: { 200: { content: { 'application/json': Models.BookEnvelope } } };
    };
  };
  "/acc/book/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BookCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.BookEnvelope } } };
    };
  };
  "/acc/book/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BookSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.BookEnvelope } } };
    };
  };
  "/acc/book/delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BookDeleteRequest } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
    };
  };
  "/acc/subject/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.SubjectQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.SubjectPageEnvelope } } };
    };
  };
  "/acc/subject/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.SubjectGetRequest } };
      responses: { 200: { content: { 'application/json': Models.SubjectEnvelope } } };
    };
  };
  "/acc/subject/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.SubjectCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.SubjectEnvelope } } };
    };
  };
  "/acc/subject/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.SubjectSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.SubjectEnvelope } } };
    };
  };
  "/acc/subject/delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.SubjectDeleteRequest } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
    };
  };
  "/acc/opening/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.OpeningQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.OpeningEnvelope } } };
    };
  };
  "/acc/opening/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.OpeningSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.OpeningEnvelope } } };
    };
  };
  "/acc/opening/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.OpeningApprovalActionRequest } };
      responses: { 200: { content: { 'application/json': Models.OpeningEnvelope } } };
    };
  };
  "/acc/opening/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.OpeningReasonActionRequest } };
      responses: { 200: { content: { 'application/json': Models.OpeningEnvelope } } };
    };
  };
  "/acc/opening/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.OpeningApprovalActionRequest } };
      responses: { 200: { content: { 'application/json': Models.OpeningEnvelope } } };
    };
  };
  "/acc/opening/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.OpeningApprovalActionRequest } };
      responses: { 200: { content: { 'application/json': Models.OpeningEnvelope } } };
    };
  };
  "/acc/opening/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.OpeningReasonActionRequest } };
      responses: { 200: { content: { 'application/json': Models.OpeningEnvelope } } };
    };
  };
  "/acc/mapping/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.MappingQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.MappingPageEnvelope } } };
    };
  };
  "/acc/mapping/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.MappingGetRequest } };
      responses: { 200: { content: { 'application/json': Models.MappingEnvelope } } };
    };
  };
  "/acc/mapping/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.MappingCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.MappingEnvelope } } };
    };
  };
  "/acc/mapping/create-next": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.MappingCreateNextRequest } };
      responses: { 200: { content: { 'application/json': Models.MappingEnvelope } } };
    };
  };
  "/acc/mapping/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.MappingVersionsRequest } };
      responses: { 200: { content: { 'application/json': Models.MappingPageEnvelope } } };
    };
  };
  "/acc/mapping/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.MappingSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.MappingEnvelope } } };
    };
  };
  "/acc/mapping/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.MappingApprovalActionRequest } };
      responses: { 200: { content: { 'application/json': Models.MappingEnvelope } } };
    };
  };
  "/acc/mapping/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.MappingReasonActionRequest } };
      responses: { 200: { content: { 'application/json': Models.MappingEnvelope } } };
    };
  };
  "/acc/mapping/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.MappingApprovalActionRequest } };
      responses: { 200: { content: { 'application/json': Models.MappingEnvelope } } };
    };
  };
  "/acc/mapping/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.MappingApprovalActionRequest } };
      responses: { 200: { content: { 'application/json': Models.MappingEnvelope } } };
    };
  };
  "/acc/mapping/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.MappingReasonActionRequest } };
      responses: { 200: { content: { 'application/json': Models.MappingEnvelope } } };
    };
  };
  "/acc/mapping/delete-version": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.MappingApprovalActionRequest } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
    };
  };
  "/acc/mapping/catalog": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.MappingCatalogRequest } };
      responses: { 200: { content: { 'application/json': Models.MappingCatalogEnvelope } } };
    };
  };
  "/acc/period/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.PeriodQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.PeriodListEnvelope } } };
    };
  };
  "/acc/period/lock": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.PeriodActionRequest } };
      responses: { 200: { content: { 'application/json': Models.PeriodEnvelope } } };
    };
  };
  "/acc/period/unlock": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.PeriodActionRequest } };
      responses: { 200: { content: { 'application/json': Models.PeriodEnvelope } } };
    };
  };
  "/app/user/signin": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.SignInRequest } };
      responses: { 200: { content: { 'application/json': Models.SessionResponse } } };
    };
  };
  "/app/user/session": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.EmptyObject } };
      responses: { 200: { content: { 'application/json': Models.SessionResponse } } };
    };
  };
  "/app/user/signout": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.EmptyObject } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
    };
  };
  "/dcl/warehouse/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclWarehouseCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseMutationResponse } } };
    };
  };
  "/dcl/warehouse/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclWarehouseSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseSaveResponse } } };
    };
  };
  "/dcl/warehouse/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseMutationResponse } } };
    };
  };
  "/dcl/warehouse/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseMutationResponse } } };
    };
  };
  "/dcl/warehouse/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseMutationResponse } } };
    };
  };
  "/dcl/warehouse/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseMutationResponse } } };
    };
  };
  "/dcl/warehouse/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseMutationResponse } } };
    };
  };
  "/dcl/warehouse/delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
    };
  };
  "/dcl/warehouse/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityGetRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseViewResponse } } };
    };
  };
  "/dcl/warehouse/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseQueryResponse } } };
    };
  };
  "/dcl/warehouse/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseVersionPageResponse } } };
    };
  };
  "/dcl/warehouse/audit-history": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseAuditHistoryResponse } } };
    };
  };
  "/dcl/fund-account/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclFundAccountCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.DclFundAccountMutationResponse } } };
    };
  };
  "/dcl/fund-account/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclFundAccountSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.DclFundAccountMutationResponse } } };
    };
  };
  "/dcl/fund-account/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclFundAccountMutationResponse } } };
    };
  };
  "/dcl/fund-account/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclFundAccountMutationResponse } } };
    };
  };
  "/dcl/fund-account/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclFundAccountMutationResponse } } };
    };
  };
  "/dcl/fund-account/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclFundAccountMutationResponse } } };
    };
  };
  "/dcl/fund-account/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclFundAccountMutationResponse } } };
    };
  };
  "/dcl/fund-account/delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': unknown } } };
    };
  };
  "/dcl/fund-account/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityGetRequest } };
      responses: { 200: { content: { 'application/json': Models.DclFundAccountViewResponse } } };
    };
  };
  "/dcl/fund-account/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclFundAccountQueryResponse } } };
    };
  };
  "/dcl/fund-account/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclFundAccountVersionPageResponse } } };
    };
  };
  "/dcl/fund-account/audit-history": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseAuditHistoryResponse } } };
    };
  };
  "/dcl/vehicle/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclVehicleCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.DclVehicleMutationResponse } } };
    };
  };
  "/dcl/vehicle/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclVehicleSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.DclVehicleMutationResponse } } };
    };
  };
  "/dcl/vehicle/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclVehicleMutationResponse } } };
    };
  };
  "/dcl/vehicle/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclVehicleMutationResponse } } };
    };
  };
  "/dcl/vehicle/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclVehicleMutationResponse } } };
    };
  };
  "/dcl/vehicle/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclVehicleMutationResponse } } };
    };
  };
  "/dcl/vehicle/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclVehicleMutationResponse } } };
    };
  };
  "/dcl/vehicle/delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
    };
  };
  "/dcl/vehicle/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityGetRequest } };
      responses: { 200: { content: { 'application/json': Models.DclVehicleViewResponse } } };
    };
  };
  "/dcl/vehicle/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclVehicleQueryResponse } } };
    };
  };
  "/dcl/vehicle/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclVehicleVersionPageResponse } } };
    };
  };
  "/dcl/vehicle/audit-history": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseAuditHistoryResponse } } };
    };
  };
  "/dcl/product/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclProductCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseMutationResponse } } };
    };
  };
  "/dcl/product/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclProductSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.DclProductSaveResponse } } };
    };
  };
  "/dcl/product/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseMutationResponse } } };
    };
  };
  "/dcl/product/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseMutationResponse } } };
    };
  };
  "/dcl/product/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseMutationResponse } } };
    };
  };
  "/dcl/product/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseMutationResponse } } };
    };
  };
  "/dcl/product/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseMutationResponse } } };
    };
  };
  "/dcl/product/delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseMutationResponse } } };
    };
  };
  "/dcl/product/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityGetRequest } };
      responses: { 200: { content: { 'application/json': Models.DclProductViewResponse } } };
    };
  };
  "/dcl/product/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclProductQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclProductQueryResponse } } };
    };
  };
  "/dcl/product/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclProductVersionPageResponse } } };
    };
  };
  "/dcl/product/audit-history": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseAuditHistoryResponse } } };
    };
  };
  "/dcl/employee/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclEmployeeCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/employee/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclEmployeeSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/employee/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/employee/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/employee/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/employee/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/employee/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/employee/delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
    };
  };
  "/dcl/employee/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityGetRequest } };
      responses: { 200: { content: { 'application/json': Models.DclEmployeeViewResponse } } };
    };
  };
  "/dcl/employee/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclEmployeeQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclEmployeeQueryResponse } } };
    };
  };
  "/dcl/employee/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclEmployeeVersionPageResponse } } };
    };
  };
  "/dcl/employee/audit-history": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityAuditHistoryResponse } } };
    };
  };
  "/dcl/other-unit/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOtherUnitCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/other-unit/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOtherUnitSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/other-unit/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/other-unit/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/other-unit/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/other-unit/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/other-unit/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/other-unit/delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
    };
  };
  "/dcl/other-unit/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityGetRequest } };
      responses: { 200: { content: { 'application/json': Models.OtherUnitGetResponse } } };
    };
  };
  "/dcl/other-unit/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.OtherUnitQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.OtherUnitQueryResponse } } };
    };
  };
  "/dcl/other-unit/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.OtherUnitQueryResponse } } };
    };
  };
  "/dcl/other-unit/audit-history": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityAuditHistoryResponse } } };
    };
  };
  "/dcl/supplier/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.SupplierQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclSupplierQueryResponse } } };
    };
  };
  "/dcl/supplier/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityGetRequest } };
      responses: { 200: { content: { 'application/json': Models.DclSupplierViewResponse } } };
    };
  };
  "/dcl/supplier/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclSupplierCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/supplier/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclSupplierSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/supplier/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/supplier/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/supplier/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/supplier/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/supplier/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/supplier/delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
    };
  };
  "/dcl/supplier/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclSupplierVersionPageResponse } } };
    };
  };
  "/dcl/supplier/audit-history": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityAuditHistoryResponse } } };
    };
  };
  "/dcl/sales-partner/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclSalesPartnerCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/sales-partner/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclSalesPartnerSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/sales-partner/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/sales-partner/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/sales-partner/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/sales-partner/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/sales-partner/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/sales-partner/delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
    };
  };
  "/dcl/sales-partner/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityGetRequest } };
      responses: { 200: { content: { 'application/json': Models.SalesPartnerGetResponse } } };
    };
  };
  "/dcl/sales-partner/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.SalesPartnerQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.SalesPartnerQueryResponse } } };
    };
  };
  "/dcl/sales-partner/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.SalesPartnerQueryResponse } } };
    };
  };
  "/dcl/sales-partner/audit-history": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityAuditHistoryResponse } } };
    };
  };
  "/dcl/party/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclPartySaveRequest } };
      responses: { 200: { content: { 'application/json': Models.DclPartyMutationResponse } } };
    };
  };
  "/dcl/party/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclPartyVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclPartyMutationResponse } } };
    };
  };
  "/dcl/party/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclPartyVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclPartyMutationResponse } } };
    };
  };
  "/dcl/party/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclPartyReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclPartyMutationResponse } } };
    };
  };
  "/dcl/party/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclPartyVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclPartyMutationResponse } } };
    };
  };
  "/dcl/party/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclPartyReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclPartyMutationResponse } } };
    };
  };
  "/dcl/party/delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclPartyVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
    };
  };
  "/dcl/party/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclPartyGetRequest } };
      responses: { 200: { content: { 'application/json': Models.DclPartyViewResponse } } };
    };
  };
  "/dcl/party/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclPartyQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclPartyQueryResponse } } };
    };
  };
  "/dcl/party/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclPartyHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclPartyVersionPageResponse } } };
    };
  };
  "/dcl/party/audit-history": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclPartyHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityAuditHistoryResponse } } };
    };
  };
  "/dcl/party/merge-preflight": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclPartyMergePreflightRequest } };
      responses: { 200: { content: { 'application/json': Models.DclPartyMergePreflightResponse } } };
    };
  };
  "/dcl/party/merge-confirm": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclPartyMergeConfirmRequest } };
      responses: { 200: { content: { 'application/json': Models.DclPartyMergeConfirmResponse } } };
    };
  };
  "/dcl/operating-entity/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/operating-entity/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntitySaveRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/operating-entity/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/operating-entity/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/operating-entity/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/operating-entity/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/operating-entity/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/operating-entity/delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
    };
  };
  "/dcl/operating-entity/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityGetRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityViewResponse } } };
    };
  };
  "/dcl/operating-entity/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityQueryResponse } } };
    };
  };
  "/dcl/operating-entity/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityVersionPageResponse } } };
    };
  };
  "/dcl/operating-entity/audit-history": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityAuditHistoryResponse } } };
    };
  };
  "/app/workbench/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WorkbenchQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.WorkbenchQueryResponse } } };
    };
  };
  "/app/user/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.UserQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.UserPageResponse } } };
    };
  };
  "/app/user/profile": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.ProfileRequest } };
      responses: { 200: { content: { 'application/json': Models.ProfileResponse } } };
    };
  };
  "/app/user/change-password": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.ChangePasswordRequest } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
    };
  };
  "/app/user/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.IdRequest } };
      responses: { 200: { content: { 'application/json': Models.UserDetailResponse } } };
    };
  };
  "/app/user/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.CreateUserRequest } };
      responses: { 200: { content: { 'application/json': Models.UserDetailResponse } } };
    };
  };
  "/app/user/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.SaveUserRequest } };
      responses: { 200: { content: { 'application/json': Models.UserDetailResponse } } };
    };
  };
  "/app/user/enable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.UserDetailResponse } } };
    };
  };
  "/app/user/disable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.UserDetailResponse } } };
    };
  };
  "/app/user/reset-password": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.ResetPasswordRequest } };
      responses: { 200: { content: { 'application/json': Models.ResetPasswordResponse } } };
    };
  };
  "/app/role/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RoleQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.RolePageResponse } } };
    };
  };
  "/app/role/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.IdRequest } };
      responses: { 200: { content: { 'application/json': Models.RoleDetailResponse } } };
    };
  };
  "/app/role/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.CreateRoleRequest } };
      responses: { 200: { content: { 'application/json': Models.RoleDetailResponse } } };
    };
  };
  "/app/role/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.SaveRoleRequest } };
      responses: { 200: { content: { 'application/json': Models.RoleDetailResponse } } };
    };
  };
  "/app/role/enable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.RoleDetailResponse } } };
    };
  };
  "/app/role/disable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.RoleDetailResponse } } };
    };
  };
  "/app/permission/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.PermissionQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.PermissionPageResponse } } };
    };
  };
  "/app/permission/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.IdRequest } };
      responses: { 200: { content: { 'application/json': Models.PermissionDetailResponse } } };
    };
  };
  "/app/system-parameter/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.SystemParameterQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.SystemParameterQueryResponse } } };
    };
  };
  "/app/system-parameter/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.SystemParameterKeyRequest } };
      responses: { 200: { content: { 'application/json': Models.SystemParameterResponse } } };
    };
  };
  "/app/system-parameter/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.SaveSystemParameterRequest } };
      responses: { 200: { content: { 'application/json': Models.SystemParameterResponse } } };
    };
  };
  "/app/system-parameter/reset": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.ResetSystemParameterRequest } };
      responses: { 200: { content: { 'application/json': Models.SystemParameterResponse } } };
    };
  };
  "/app/menu/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.EmptyObject } };
      responses: { 200: { content: { 'application/json': Models.MenuGetResponse } } };
    };
  };
  "/app/menu/save-business": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.SaveBusinessMenuRequest } };
      responses: { 200: { content: { 'application/json': Models.MenuGetResponse } } };
    };
  };
  "/app/menu/activate": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.ActivateMenuRequest } };
      responses: { 200: { content: { 'application/json': Models.MenuGetResponse } } };
    };
  };
  "/app/menu/reset-business": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.ResetBusinessMenuRequest } };
      responses: { 200: { content: { 'application/json': Models.MenuGetResponse } } };
    };
  };
  "/aux/{entity}/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.AuxEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.AuxQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.AuxQueryResponse } } };
    };
  };
  "/aux/{entity}/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.AuxEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.AuxGetRequest } };
      responses: { 200: { content: { 'application/json': Models.AuxObjectResponse } } };
    };
  };
  "/aux/{entity}/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.AuxEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.AuxCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.AuxMutationResponse } } };
    };
  };
  "/aux/{entity}/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.AuxEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.AuxSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.AuxMutationResponse } } };
    };
  };
  "/aux/{entity}/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.AuxEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.AuxApprovalRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.AuxMutationResponse } } };
    };
  };
  "/aux/{entity}/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.AuxEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.AuxApprovalRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.AuxMutationResponse } } };
    };
  };
  "/aux/{entity}/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.AuxEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.AuxApprovalRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.AuxMutationResponse } } };
    };
  };
  "/aux/{entity}/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.AuxEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.AuxReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.AuxMutationResponse } } };
    };
  };
  "/aux/{entity}/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.AuxEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.AuxReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.AuxMutationResponse } } };
    };
  };
  "/aux/{entity}/enable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.AuxEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.AuxObjectRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.AuxMutationResponse } } };
    };
  };
  "/aux/{entity}/disable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.AuxEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.AuxObjectRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.AuxMutationResponse } } };
    };
  };
  "/aux/{entity}/delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.AuxEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.AuxApprovalRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
    };
  };
  "/aux/{entity}/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.AuxEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.AuxHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.AuxVersionPageResponse } } };
    };
  };
  "/aux/{entity}/audit-history": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.AuxEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.AuxHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.AuxAuditEventPageResponse } } };
    };
  };
  "/bob/party/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.PartyQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.PartyQueryResponse } } };
    };
  };
  "/bob/party/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.PartyGetRequest } };
      responses: { 200: { content: { 'application/json': Models.PartyGetResponse } } };
    };
  };
  "/bob/other-unit/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.OtherUnitQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.OtherUnitQueryResponse } } };
    };
  };
  "/bob/other-unit/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobGetRequest } };
      responses: { 200: { content: { 'application/json': Models.OtherUnitGetResponse } } };
    };
  };
  "/bob/customer/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.CustomerQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.CustomerQueryResponse } } };
    };
  };
  "/bob/customer/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobGetRequest } };
      responses: { 200: { content: { 'application/json': Models.CustomerGetResponse } } };
    };
  };
  "/bob/customer/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.CustomerCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.CustomerCreateResponse } } };
    };
  };
  "/bob/customer/account-add": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.CustomerAccountAddRequest } };
      responses: { 200: { content: { 'application/json': Models.CustomerAccountResponse } } };
    };
  };
  "/bob/customer/account-delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobDeleteRequest } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
    };
  };
  "/bob/customer/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.CustomerSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.BobMutationResponse } } };
    };
  };
  "/bob/customer/attachment-initiate": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.CustomerAttachmentInitiateRequest } };
      responses: { 200: { content: { 'application/json': Models.CustomerAttachmentInitiateResponse } } };
    };
  };
  "/bob/customer/attachment-download": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.CustomerAttachmentDownloadRequest } };
      responses: { 200: { content: { 'application/json': Models.CustomerAttachmentDownloadResponse } } };
    };
  };
  "/bob/customer/attachment-remove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.CustomerAttachmentRemoveRequest } };
      responses: { 200: { content: { 'application/json': Models.CustomerAttachmentRemoveResponse } } };
    };
  };
  "/bob/supplier/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.SupplierQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.SupplierQueryResponse } } };
    };
  };
  "/bob/supplier/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobGetRequest } };
      responses: { 200: { content: { 'application/json': Models.SupplierGetResponse } } };
    };
  };
  "/bob/reference/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobReferenceQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.ReferenceQueryResponse } } };
    };
  };
  "/aux/reference/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.AuxReferenceQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.ReferenceQueryResponse } } };
    };
  };
  "/bob/sales-partner/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.SalesPartnerQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.SalesPartnerQueryResponse } } };
    };
  };
  "/bob/sales-partner/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobGetRequest } };
      responses: { 200: { content: { 'application/json': Models.SalesPartnerGetResponse } } };
    };
  };
  "/bob/{entity}/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobReadableEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.BobQueryResponse } } };
    };
  };
  "/bob/{entity}/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobReadableEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobGetRequest } };
      responses: { 200: { content: { 'application/json': Models.BobObjectResponse } } };
    };
  };
  "/bob/{entity}/delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobLifecycleEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobDeleteRequest } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
    };
  };
  "/bob/{entity}/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobLifecycleEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobVersionRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.BobMutationResponse } } };
    };
  };
  "/bob/{entity}/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobLifecycleEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobVersionRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.BobMutationResponse } } };
    };
  };
  "/bob/{entity}/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobLifecycleEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobVersionRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.BobMutationResponse } } };
    };
  };
  "/bob/{entity}/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobLifecycleEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.BobMutationResponse } } };
    };
  };
  "/bob/{entity}/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobLifecycleEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.BobUnapproveResponse } } };
    };
  };
  "/bob/{entity}/enable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobLifecycleEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobObjectRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.BobMutationResponse } } };
    };
  };
  "/bob/{entity}/disable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobLifecycleEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobObjectRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.BobDisableResponse } } };
    };
  };
  "/bob/{entity}/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobLifecycleEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.BobVersionHistoryResponse } } };
    };
  };
  "/bob/{entity}/audit-history": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobLifecycleEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.BobAuditHistoryResponse } } };
    };
  };
  "/vou/{entity}/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.VouEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.VouQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.VouQueryResponse } } };
    };
  };
  "/vou/{entity}/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.VouEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.VouGetRequest } };
      responses: { 200: { content: { 'application/json': Models.VouDocumentResponse } } };
    };
  };
  "/vou/{entity}/source": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.VouEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.VouIntermediarySourceRequest } };
      responses: { 200: { content: { 'application/json': Models.VouIntermediarySourceResponse } } };
    };
  };
  "/vou/{entity}/script-get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.VouEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.EmptyObject } };
      responses: { 200: { content: { 'application/json': Models.VouIntermediaryScriptGetResponse } } };
    };
  };
  "/vou/{entity}/script-save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.VouEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.VouIntermediaryScriptSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.VouIntermediaryScriptGetResponse } } };
    };
  };
  "/vou/{entity}/book-balance": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.VouEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.VouInventoryCountBalanceRequest } };
      responses: { 200: { content: { 'application/json': Models.VouInventoryCountBalanceResponse } } };
    };
  };
  "/vou/{entity}/bill-source": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.VouEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.VouAvailableBillQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.VouAvailableBillQueryResponse } } };
    };
  };
  "/vou/{entity}/asset-source": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.VouEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.VouAvailableAssetQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.VouAvailableAssetQueryResponse } } };
    };
  };
  "/vou/{entity}/formula-default": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.VouEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.VouFormulaDefaultRequest } };
      responses: { 200: { content: { 'application/json': Models.VouFormulaDefaultResponse } } };
    };
  };
  "/vou/{entity}/price-reference": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.VouEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.VouPriceReferenceRequest } };
      responses: { 200: { content: { 'application/json': Models.VouPriceReferenceResponse } } };
    };
  };
  "/vou/{entity}/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.VouCreatableEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.VouCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.VouMutationResponse } } };
    };
  };
  "/vou/{entity}/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.VouEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.VouSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.VouMutationResponse } } };
    };
  };
  "/vou/{entity}/delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.VouEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.VouReverseRequest } };
      responses: { 200: { content: { 'application/json': Models.VouMutationResponse } } };
    };
  };
  "/vou/{entity}/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.VouEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.VouDocumentRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.VouMutationResponse } } };
    };
  };
  "/vou/{entity}/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.VouEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.VouDocumentRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.VouMutationResponse } } };
    };
  };
  "/vou/{entity}/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.VouEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.VouDocumentRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.VouMutationResponse } } };
    };
  };
  "/vou/{entity}/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.VouEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.VouReverseRequest } };
      responses: { 200: { content: { 'application/json': Models.VouMutationResponse } } };
    };
  };
  "/vou/{entity}/audit-history": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.VouEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.VouHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.VouAuditHistoryResponse } } };
    };
  };
  "/vou/{entity}/attachment-initiate": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.VouEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.VouAttachmentInitiateRequest } };
      responses: { 200: { content: { 'application/json': Models.VouAttachmentInitiateResponse } } };
    };
  };
  "/vou/{entity}/attachment-download": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.VouEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.VouAttachmentDownloadRequest } };
      responses: { 200: { content: { 'application/json': Models.VouAttachmentDownloadResponse } } };
    };
  };
  "/vou/{entity}/attachment-remove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.VouEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.VouAttachmentRemoveRequest } };
      responses: { 200: { content: { 'application/json': Models.VouMutationResponse } } };
    };
  };
  "/wfl/process-definition/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflDefinitionQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.WflDefinitionQueryResponse } } };
    };
  };
  "/wfl/process-definition/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflDefinitionGetRequest } };
      responses: { 200: { content: { 'application/json': Models.WflDefinitionViewResponse } } };
    };
  };
  "/wfl/process-definition/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflDefinitionCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.WflDefinitionViewResponse } } };
    };
  };
  "/wfl/process-definition/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflDefinitionSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.WflDefinitionViewResponse } } };
    };
  };
  "/wfl/process-definition/trial": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflDefinitionTrialRequest } };
      responses: { 200: { content: { 'application/json': Models.WflDefinitionTrialResponse } } };
    };
  };
  "/wfl/process-definition/create-version": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflDefinitionVersionCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.WflDefinitionViewResponse } } };
    };
  };
  "/wfl/process-definition/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflDefinitionVersionsRequest } };
      responses: { 200: { content: { 'application/json': Models.WflDefinitionQueryResponse } } };
    };
  };
  "/wfl/process-definition/delete-version": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflDefinitionActionRequest } };
      responses: { 200: { content: { 'application/json': Models.WflDefinitionDeleteResponse } } };
    };
  };
  "/wfl/process-definition/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflDefinitionActionRequest } };
      responses: { 200: { content: { 'application/json': Models.WflDefinitionViewResponse } } };
    };
  };
  "/wfl/process-definition/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflDefinitionActionRequest } };
      responses: { 200: { content: { 'application/json': Models.WflDefinitionViewResponse } } };
    };
  };
  "/wfl/process-definition/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflDefinitionReasonActionRequest } };
      responses: { 200: { content: { 'application/json': Models.WflDefinitionViewResponse } } };
    };
  };
  "/wfl/process-definition/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflDefinitionActionRequest } };
      responses: { 200: { content: { 'application/json': Models.WflDefinitionViewResponse } } };
    };
  };
  "/wfl/process-definition/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflDefinitionReasonActionRequest } };
      responses: { 200: { content: { 'application/json': Models.WflDefinitionViewResponse } } };
    };
  };
  "/wfl/process-definition/enable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflDefinitionToggleRequest } };
      responses: { 200: { content: { 'application/json': Models.WflDefinitionViewResponse } } };
    };
  };
  "/wfl/process-definition/disable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflDefinitionToggleRequest } };
      responses: { 200: { content: { 'application/json': Models.WflDefinitionViewResponse } } };
    };
  };
  "/wfl/process-instance/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflInstanceQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.WflInstanceQueryResponse } } };
    };
  };
  "/wfl/{processName}/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "processName": string; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflInstanceQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.WflInstanceQueryResponse } } };
    };
  };
  "/wfl/{processName}/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "processName": string; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflInstanceGetRequest } };
      responses: { 200: { content: { 'application/json': Models.WflInstanceViewResponse } } };
    };
  };
  "/wfl/{processName}/audit-history": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "processName": string; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflInstanceHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.WflInstanceHistoryResponse } } };
    };
  };
  "/wfl/{processName}/create-child": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "processName": string; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflCreateChildRequest } };
      responses: { 200: { content: { 'application/json': Models.WflCreateChildResponse } } };
    };
  };
  "/wfl/process-instance/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflInstanceGetRequest } };
      responses: { 200: { content: { 'application/json': Models.WflInstanceViewResponse } } };
    };
  };
  "/wfl/process-instance/audit-history": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflInstanceHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.WflInstanceHistoryResponse } } };
    };
  };
  "/rpt/definition/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptDefinitionQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.RptDefinitionPageResponse } } };
    };
  };
  "/rpt/definition/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptDefinitionGetRequest } };
      responses: { 200: { content: { 'application/json': Models.RptDefinitionViewResponse } } };
    };
  };
  "/rpt/definition/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptDefinitionCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.RptDefinitionViewResponse } } };
    };
  };
  "/rpt/definition/create-version": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptVersionCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.RptDefinitionViewResponse } } };
    };
  };
  "/rpt/definition/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptVersionSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.RptDefinitionViewResponse } } };
    };
  };
  "/rpt/definition/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptVersionListRequest } };
      responses: { 200: { content: { 'application/json': Models.RptDefinitionVersionPageResponse } } };
    };
  };
  "/rpt/definition/delete-version": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptVersionDeleteRequest } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
    };
  };
  "/rpt/definition/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptVersionActionRequest } };
      responses: { 200: { content: { 'application/json': Models.RptDefinitionViewResponse } } };
    };
  };
  "/rpt/definition/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptVersionActionRequest } };
      responses: { 200: { content: { 'application/json': Models.RptDefinitionViewResponse } } };
    };
  };
  "/rpt/definition/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptVersionReasonActionRequest } };
      responses: { 200: { content: { 'application/json': Models.RptDefinitionViewResponse } } };
    };
  };
  "/rpt/definition/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptVersionActionRequest } };
      responses: { 200: { content: { 'application/json': Models.RptDefinitionViewResponse } } };
    };
  };
  "/rpt/definition/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptVersionReasonActionRequest } };
      responses: { 200: { content: { 'application/json': Models.RptDefinitionViewResponse } } };
    };
  };
  "/rpt/definition/enable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptDefinitionRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.RptDefinitionViewResponse } } };
    };
  };
  "/rpt/definition/disable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptDefinitionRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.RptDefinitionViewResponse } } };
    };
  };
  "/rpt/definition/delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptDefinitionRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
    };
  };
  "/rpt/{report}/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "report": string; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptExecuteRequest } };
      responses: { 200: { content: { 'application/json': Models.RptQueryResponse } } };
    };
  };
  "/rpt/directory/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptDirectoryQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.RptDirectoryPageResponse } } };
    };
  };
  "/rpt/{report}/export": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "report": string; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptExecuteRequest } };
      responses: { 200: { content: { 'application/json': unknown } } };
    };
  };
  "/rpt/{report}/reference-query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "report": string; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptReferenceQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.RptReferencePageResponse } } };
    };
  };
  "/files/customer-attachments/upload/{token}": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post?: never;
  };
  "/files/customer-attachments/download/{token}": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post?: never;
  };
  "/files/attachments/upload/{token}": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post?: never;
  };
  "/files/attachments/download/{token}": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post?: never;
  };
  "/healthz": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post?: never;
  };
  "/readyz": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post?: never;
  };
}

export interface components {
  schemas: {
      "ApprovalStatus": Models.ApprovalStatus;
      "ApprovalMeta": Models.ApprovalMeta;
      "ApprovalVersionMeta": Models.ApprovalVersionMeta;
      "BookQueryRequest": Models.BookQueryRequest;
      "SubjectTemplate": Models.SubjectTemplate;
      "Book": Models.Book;
      "BookPage": Models.BookPage;
      "BookPageEnvelope": Models.BookPageEnvelope;
      "BookGetRequest": Models.BookGetRequest;
      "BookEnvelope": Models.BookEnvelope;
      "BookCreateRequest": Models.BookCreateRequest;
      "BookSaveRequest": Models.BookSaveRequest;
      "BookDeleteRequest": Models.BookDeleteRequest;
      "EmptyObject": Models.EmptyObject;
      "EmptyResponse": Models.EmptyResponse;
      "SubjectQueryRequest": Models.SubjectQueryRequest;
      "BalanceDirection": Models.BalanceDirection;
      "SubjectDimension": Models.SubjectDimension;
      "SettlementPurpose": Models.SettlementPurpose;
      "Subject": Models.Subject;
      "SubjectPage": Models.SubjectPage;
      "SubjectPageEnvelope": Models.SubjectPageEnvelope;
      "SubjectGetRequest": Models.SubjectGetRequest;
      "SubjectEnvelope": Models.SubjectEnvelope;
      "SubjectCreateRequest": Models.SubjectCreateRequest;
      "SubjectSaveRequest": Models.SubjectSaveRequest;
      "SubjectDeleteRequest": Models.SubjectDeleteRequest;
      "OpeningQueryRequest": Models.OpeningQueryRequest;
      "OpeningLine": Models.OpeningLine;
      "OpeningAsset": Models.OpeningAsset;
      "OpeningPartyInput": Models.OpeningPartyInput;
      "OpeningBill": Models.OpeningBill;
      "OpeningContainerInput": Models.OpeningContainerInput;
      "Opening": Models.Opening;
      "OpeningEnvelope": Models.OpeningEnvelope;
      "OpeningLineInput": Models.OpeningLineInput;
      "OpeningAssetInput": Models.OpeningAssetInput;
      "OpeningBillInput": Models.OpeningBillInput;
      "OpeningSaveRequest": Models.OpeningSaveRequest;
      "OpeningApprovalActionRequest": Models.OpeningApprovalActionRequest;
      "OpeningReasonActionRequest": Models.OpeningReasonActionRequest;
      "MappingQueryRequest": Models.MappingQueryRequest;
      "MappingResult": Models.MappingResult;
      "MappingConditionOperator": Models.MappingConditionOperator;
      "MappingCondition": Models.MappingCondition;
      "MappingRule": Models.MappingRule;
      "PostingLineTemplate": Models.PostingLineTemplate;
      "PostingTemplate": Models.PostingTemplate;
      "AssetAccountingConfiguration": Models.AssetAccountingConfiguration;
      "MappingDefinition": Models.MappingDefinition;
      "Mapping": Models.Mapping;
      "MappingPage": Models.MappingPage;
      "MappingPageEnvelope": Models.MappingPageEnvelope;
      "MappingGetRequest": Models.MappingGetRequest;
      "MappingEnvelope": Models.MappingEnvelope;
      "MappingCreateRequest": Models.MappingCreateRequest;
      "MappingCreateNextRequest": Models.MappingCreateNextRequest;
      "MappingVersionsRequest": Models.MappingVersionsRequest;
      "MappingSaveRequest": Models.MappingSaveRequest;
      "MappingApprovalActionRequest": Models.MappingApprovalActionRequest;
      "MappingReasonActionRequest": Models.MappingReasonActionRequest;
      "MappingCatalogRequest": Models.MappingCatalogRequest;
      "MappingCatalog": Models.MappingCatalog;
      "MappingCatalogEnvelope": Models.MappingCatalogEnvelope;
      "PeriodQueryRequest": Models.PeriodQueryRequest;
      "Period": Models.Period;
      "PeriodListEnvelope": Models.PeriodListEnvelope;
      "PeriodActionRequest": Models.PeriodActionRequest;
      "PeriodEnvelope": Models.PeriodEnvelope;
      "SignInRequest": Models.SignInRequest;
      "SessionUser": Models.SessionUser;
      "SessionData": Models.SessionData;
      "SessionResponse": Models.SessionResponse;
      "DclWarehouseData": Models.DclWarehouseData;
      "DclWarehouseCreateRequest": Models.DclWarehouseCreateRequest;
      "DclOperatingEntityMutation": Models.DclOperatingEntityMutation;
      "DclWarehouseMutationResponse": Models.DclWarehouseMutationResponse;
      "DclWarehouseSaveRequest": Models.DclWarehouseSaveRequest;
      "DclWarehouseInventoryConflict": Models.DclWarehouseInventoryConflict;
      "VouEntity": Models.VouEntity;
      "DclWarehouseDocumentConflict": Models.DclWarehouseDocumentConflict;
      "DclWarehouseReferenceCount": Models.DclWarehouseReferenceCount;
      "DclWarehouseDisableBlockers": Models.DclWarehouseDisableBlockers;
      "DclWarehouseSaveResponse": Models.DclWarehouseSaveResponse;
      "DclOperatingEntityVersionRequest": Models.DclOperatingEntityVersionRequest;
      "DclOperatingEntityReviewRequest": Models.DclOperatingEntityReviewRequest;
      "DclOperatingEntityGetRequest": Models.DclOperatingEntityGetRequest;
      "DclWarehouseView": Models.DclWarehouseView;
      "DclWarehouseViewResponse": Models.DclWarehouseViewResponse;
      "DclOperatingEntityQueryRequest": Models.DclOperatingEntityQueryRequest;
      "DclWarehouseVersionView": Models.DclWarehouseVersionView;
      "DclWarehouseListItem": Models.DclWarehouseListItem;
      "DclWarehouseQueryPage": Models.DclWarehouseQueryPage;
      "DclWarehouseQueryResponse": Models.DclWarehouseQueryResponse;
      "DclOperatingEntityHistoryRequest": Models.DclOperatingEntityHistoryRequest;
      "DclWarehouseVersionPage": Models.DclWarehouseVersionPage;
      "DclWarehouseVersionPageResponse": Models.DclWarehouseVersionPageResponse;
      "ApprovalEventView": Models.ApprovalEventView;
      "DclOperatingEntityAuditEventPage": Models.DclOperatingEntityAuditEventPage;
      "DclWarehouseAuditHistoryResponse": Models.DclWarehouseAuditHistoryResponse;
      "DclFundAccountData": Models.DclFundAccountData;
      "DclFundAccountCreateRequest": Models.DclFundAccountCreateRequest;
      "DclFundAccountMutationResponse": Models.DclFundAccountMutationResponse;
      "DclFundAccountSaveRequest": Models.DclFundAccountSaveRequest;
      "DclFundAccountView": Models.DclFundAccountView;
      "DclFundAccountViewResponse": Models.DclFundAccountViewResponse;
      "DclFundAccountVersionView": Models.DclFundAccountVersionView;
      "DclFundAccountListItem": Models.DclFundAccountListItem;
      "DclFundAccountQueryPage": Models.DclFundAccountQueryPage;
      "DclFundAccountQueryResponse": Models.DclFundAccountQueryResponse;
      "DclFundAccountVersionPage": Models.DclFundAccountVersionPage;
      "DclFundAccountVersionPageResponse": Models.DclFundAccountVersionPageResponse;
      "VehicleInternalCarrierAffiliation": Models.VehicleInternalCarrierAffiliation;
      "VehicleExternalCarrierAffiliation": Models.VehicleExternalCarrierAffiliation;
      "VehicleCarrierAffiliation": Models.VehicleCarrierAffiliation;
      "DclVehicleData": Models.DclVehicleData;
      "DclVehicleCreateRequest": Models.DclVehicleCreateRequest;
      "DclVehicleMutationResponse": Models.DclVehicleMutationResponse;
      "DclVehicleSaveRequest": Models.DclVehicleSaveRequest;
      "DclVehicleView": Models.DclVehicleView;
      "DclVehicleViewResponse": Models.DclVehicleViewResponse;
      "DclVehicleVersionView": Models.DclVehicleVersionView;
      "DclVehicleListItem": Models.DclVehicleListItem;
      "DclVehicleQueryPage": Models.DclVehicleQueryPage;
      "DclVehicleQueryResponse": Models.DclVehicleQueryResponse;
      "DclVehicleVersionPage": Models.DclVehicleVersionPage;
      "DclVehicleVersionPageResponse": Models.DclVehicleVersionPageResponse;
      "BobMeasurementUnitSnapshotInput": Models.BobMeasurementUnitSnapshotInput;
      "BobProductUnitConversionInput": Models.BobProductUnitConversionInput;
      "BobQuantitySnapshotInput": Models.BobQuantitySnapshotInput;
      "BobProductFormulaComponentInput": Models.BobProductFormulaComponentInput;
      "BobProductFormulaInput": Models.BobProductFormulaInput;
      "DclProductInput": Models.DclProductInput;
      "DclProductCreateRequest": Models.DclProductCreateRequest;
      "DclProductSaveRequest": Models.DclProductSaveRequest;
      "BobMeasurementUnitSnapshot": Models.BobMeasurementUnitSnapshot;
      "BobProductUnitConversionSnapshot": Models.BobProductUnitConversionSnapshot;
      "DclProductQuantitySnapshot": Models.DclProductQuantitySnapshot;
      "DclProductFormulaComponentSnapshot": Models.DclProductFormulaComponentSnapshot;
      "DclProductFormulaSnapshot": Models.DclProductFormulaSnapshot;
      "DclProductData": Models.DclProductData;
      "DclProductView": Models.DclProductView;
      "DclProductSaveResponse": Models.DclProductSaveResponse;
      "DclProductViewResponse": Models.DclProductViewResponse;
      "DclProductQueryRequest": Models.DclProductQueryRequest;
      "DclProductVersionView": Models.DclProductVersionView;
      "DclProductListItem": Models.DclProductListItem;
      "DclProductQueryPage": Models.DclProductQueryPage;
      "DclProductQueryResponse": Models.DclProductQueryResponse;
      "DclProductVersionPage": Models.DclProductVersionPage;
      "DclProductVersionPageResponse": Models.DclProductVersionPageResponse;
      "DclEmployeeInput": Models.DclEmployeeInput;
      "PartyKind": Models.PartyKind;
      "PartyIdentifierType": Models.PartyIdentifierType;
      "PartyIdentifier": Models.PartyIdentifier;
      "PartyIdentityData": Models.PartyIdentityData;
      "DclEmployeeCreateRequest": Models.DclEmployeeCreateRequest;
      "DclOperatingEntityMutationResponse": Models.DclOperatingEntityMutationResponse;
      "DclEmployeeSaveRequest": Models.DclEmployeeSaveRequest;
      "DclEmployeeData": Models.DclEmployeeData;
      "DclEmployeeView": Models.DclEmployeeView;
      "DclEmployeeViewResponse": Models.DclEmployeeViewResponse;
      "DclEmployeeQueryRequest": Models.DclEmployeeQueryRequest;
      "DclEmployeeVersionView": Models.DclEmployeeVersionView;
      "DclEmployeeListItem": Models.DclEmployeeListItem;
      "DclEmployeeQueryPage": Models.DclEmployeeQueryPage;
      "DclEmployeeQueryResponse": Models.DclEmployeeQueryResponse;
      "DclEmployeeVersionPage": Models.DclEmployeeVersionPage;
      "DclEmployeeVersionPageResponse": Models.DclEmployeeVersionPageResponse;
      "DclOperatingEntityAuditHistoryResponse": Models.DclOperatingEntityAuditHistoryResponse;
      "DclOtherUnitInput": Models.DclOtherUnitInput;
      "DclOtherUnitCreateRequest": Models.DclOtherUnitCreateRequest;
      "DclOtherUnitSaveRequest": Models.DclOtherUnitSaveRequest;
      "OtherUnitData": Models.OtherUnitData;
      "OtherUnitView": Models.OtherUnitView;
      "OtherUnitGetResponse": Models.OtherUnitGetResponse;
      "OtherUnitQueryRequest": Models.OtherUnitQueryRequest;
      "OtherUnitPage": Models.OtherUnitPage;
      "OtherUnitQueryResponse": Models.OtherUnitQueryResponse;
      "SupplierQueryRequest": Models.SupplierQueryRequest;
      "SupplierSettlementSnapshot": Models.SupplierSettlementSnapshot;
      "SupplierPurchaserSnapshot": Models.SupplierPurchaserSnapshot;
      "DclSupplierData": Models.DclSupplierData;
      "DclSupplierVersionView": Models.DclSupplierVersionView;
      "DclSupplierListItem": Models.DclSupplierListItem;
      "DclSupplierQueryPage": Models.DclSupplierQueryPage;
      "DclSupplierQueryResponse": Models.DclSupplierQueryResponse;
      "DclSupplierView": Models.DclSupplierView;
      "DclSupplierViewResponse": Models.DclSupplierViewResponse;
      "DclSupplierInput": Models.DclSupplierInput;
      "DclSupplierCreateRequest": Models.DclSupplierCreateRequest;
      "DclSupplierSaveRequest": Models.DclSupplierSaveRequest;
      "DclSupplierVersionPage": Models.DclSupplierVersionPage;
      "DclSupplierVersionPageResponse": Models.DclSupplierVersionPageResponse;
      "SalesPartnerCapability": Models.SalesPartnerCapability;
      "DclSalesPartnerInput": Models.DclSalesPartnerInput;
      "DclSalesPartnerCreateRequest": Models.DclSalesPartnerCreateRequest;
      "DclSalesPartnerSaveRequest": Models.DclSalesPartnerSaveRequest;
      "SalesPartnerDataView": Models.SalesPartnerDataView;
      "SalesPartnerVersionView": Models.SalesPartnerVersionView;
      "SalesPartnerDetailView": Models.SalesPartnerDetailView;
      "SalesPartnerGetResponse": Models.SalesPartnerGetResponse;
      "SalesPartnerQueryRequest": Models.SalesPartnerQueryRequest;
      "SalesPartnerListVersion": Models.SalesPartnerListVersion;
      "SalesPartnerListItem": Models.SalesPartnerListItem;
      "SalesPartnerPage": Models.SalesPartnerPage;
      "SalesPartnerQueryResponse": Models.SalesPartnerQueryResponse;
      "DclPartyData": Models.DclPartyData;
      "DclPartySaveRequest": Models.DclPartySaveRequest;
      "DclPartyMutation": Models.DclPartyMutation;
      "DclPartyMutationResponse": Models.DclPartyMutationResponse;
      "DclPartyVersionRequest": Models.DclPartyVersionRequest;
      "DclPartyReviewRequest": Models.DclPartyReviewRequest;
      "DclPartyGetRequest": Models.DclPartyGetRequest;
      "PartyRelationshipCard": Models.PartyRelationshipCard;
      "DclPartyView": Models.DclPartyView;
      "DclPartyViewResponse": Models.DclPartyViewResponse;
      "DclPartyQueryRequest": Models.DclPartyQueryRequest;
      "DclPartyVersionView": Models.DclPartyVersionView;
      "DclPartyListItem": Models.DclPartyListItem;
      "DclPartyQueryPage": Models.DclPartyQueryPage;
      "DclPartyQueryResponse": Models.DclPartyQueryResponse;
      "DclPartyHistoryRequest": Models.DclPartyHistoryRequest;
      "DclPartyVersionPage": Models.DclPartyVersionPage;
      "DclPartyVersionPageResponse": Models.DclPartyVersionPageResponse;
      "DclPartyMergePreflightRequest": Models.DclPartyMergePreflightRequest;
      "DclPartyMergeRelationshipConflict": Models.DclPartyMergeRelationshipConflict;
      "DclPartyMergePreflightResult": Models.DclPartyMergePreflightResult;
      "DclPartyMergePreflightResponse": Models.DclPartyMergePreflightResponse;
      "DclPartyMergeConflictResolution": Models.DclPartyMergeConflictResolution;
      "DclPartyMergeConfirmRequest": Models.DclPartyMergeConfirmRequest;
      "DclPartyMergeResult": Models.DclPartyMergeResult;
      "DclPartyMergeConfirmResponse": Models.DclPartyMergeConfirmResponse;
      "DclOperatingEntityData": Models.DclOperatingEntityData;
      "DclOperatingEntityCreateRequest": Models.DclOperatingEntityCreateRequest;
      "DclOperatingEntitySaveRequest": Models.DclOperatingEntitySaveRequest;
      "DclOperatingEntityView": Models.DclOperatingEntityView;
      "DclOperatingEntityViewResponse": Models.DclOperatingEntityViewResponse;
      "DclOperatingEntityVersionView": Models.DclOperatingEntityVersionView;
      "DclOperatingEntityListItem": Models.DclOperatingEntityListItem;
      "DclOperatingEntityQueryPage": Models.DclOperatingEntityQueryPage;
      "DclOperatingEntityQueryResponse": Models.DclOperatingEntityQueryResponse;
      "DclOperatingEntityVersionPage": Models.DclOperatingEntityVersionPage;
      "DclOperatingEntityVersionPageResponse": Models.DclOperatingEntityVersionPageResponse;
      "WorkbenchCategory": Models.WorkbenchCategory;
      "WorkbenchPendingStage": Models.WorkbenchPendingStage;
      "WorkbenchQueryRequest": Models.WorkbenchQueryRequest;
      "BobEntity": Models.BobEntity;
      "WorkbenchAction": Models.WorkbenchAction;
      "WorkbenchObjectItem": Models.WorkbenchObjectItem;
      "WorkbenchDocumentItem": Models.WorkbenchDocumentItem;
      "WorkbenchPage": Models.WorkbenchPage;
      "WorkbenchQueryResponse": Models.WorkbenchQueryResponse;
      "UserStatus": Models.UserStatus;
      "UserQueryRequest": Models.UserQueryRequest;
      "UserListItem": Models.UserListItem;
      "UserPage": Models.UserPage;
      "UserPageResponse": Models.UserPageResponse;
      "ProfileRequest": Models.ProfileRequest;
      "ProfileView": Models.ProfileView;
      "ProfileResponse": Models.ProfileResponse;
      "ChangePasswordRequest": Models.ChangePasswordRequest;
      "IdRequest": Models.IdRequest;
      "RoleType": Models.RoleType;
      "UserRoleSummary": Models.UserRoleSummary;
      "UserDetail": Models.UserDetail;
      "UserDetailResponse": Models.UserDetailResponse;
      "CreateUserRequest": Models.CreateUserRequest;
      "SaveUserRequest": Models.SaveUserRequest;
      "RevisionRequest": Models.RevisionRequest;
      "ResetPasswordRequest": Models.ResetPasswordRequest;
      "ResetPasswordResult": Models.ResetPasswordResult;
      "ResetPasswordResponse": Models.ResetPasswordResponse;
      "RoleQueryRequest": Models.RoleQueryRequest;
      "RoleAction": Models.RoleAction;
      "RoleListItem": Models.RoleListItem;
      "RolePage": Models.RolePage;
      "RolePageResponse": Models.RolePageResponse;
      "RolePermission": Models.RolePermission;
      "RoleDetail": Models.RoleDetail;
      "RoleDetailResponse": Models.RoleDetailResponse;
      "CreateRoleRequest": Models.CreateRoleRequest;
      "SaveRoleRequest": Models.SaveRoleRequest;
      "PermissionQueryRequest": Models.PermissionQueryRequest;
      "PermissionView": Models.PermissionView;
      "PermissionPage": Models.PermissionPage;
      "PermissionPageResponse": Models.PermissionPageResponse;
      "PermissionDetail": Models.PermissionDetail;
      "PermissionDetailResponse": Models.PermissionDetailResponse;
      "SystemParameterValueType": Models.SystemParameterValueType;
      "SystemParameterQueryRequest": Models.SystemParameterQueryRequest;
      "SystemParameterConstraints": Models.SystemParameterConstraints;
      "SystemParameterView": Models.SystemParameterView;
      "SystemParameterPage": Models.SystemParameterPage;
      "SystemParameterQueryResponse": Models.SystemParameterQueryResponse;
      "SystemParameterKeyRequest": Models.SystemParameterKeyRequest;
      "SystemParameterResponse": Models.SystemParameterResponse;
      "SaveSystemParameterRequest": Models.SaveSystemParameterRequest;
      "ResetSystemParameterRequest": Models.ResetSystemParameterRequest;
      "MenuMode": Models.MenuMode;
      "MenuItemType": Models.MenuItemType;
      "MenuItemView": Models.MenuItemView;
      "MenuTree": Models.MenuTree;
      "MenuRouteOption": Models.MenuRouteOption;
      "MenuGetData": Models.MenuGetData;
      "MenuGetResponse": Models.MenuGetResponse;
      "SaveMenuItem": Models.SaveMenuItem;
      "SaveBusinessMenuRequest": Models.SaveBusinessMenuRequest;
      "ActivateMenuRequest": Models.ActivateMenuRequest;
      "ResetBusinessMenuRequest": Models.ResetBusinessMenuRequest;
      "AuxEntity": Models.AuxEntity;
      "ProductBehaviorProfile": Models.ProductBehaviorProfile;
      "AuxQueryRequest": Models.AuxQueryRequest;
      "AuxData": Models.AuxData;
      "AuxVersionView": Models.AuxVersionView;
      "AuxObjectView": Models.AuxObjectView;
      "AuxObjectPage": Models.AuxObjectPage;
      "AuxQueryResponse": Models.AuxQueryResponse;
      "AuxGetRequest": Models.AuxGetRequest;
      "AuxObjectResponse": Models.AuxObjectResponse;
      "AuxCreateData": Models.AuxCreateData;
      "AuxCreateRequest": Models.AuxCreateRequest;
      "AuxMutationResult": Models.AuxMutationResult;
      "AuxMutationResponse": Models.AuxMutationResponse;
      "AuxSaveRequest": Models.AuxSaveRequest;
      "AuxApprovalRevisionRequest": Models.AuxApprovalRevisionRequest;
      "AuxReviewRequest": Models.AuxReviewRequest;
      "AuxObjectRevisionRequest": Models.AuxObjectRevisionRequest;
      "AuxHistoryRequest": Models.AuxHistoryRequest;
      "AuxVersionPage": Models.AuxVersionPage;
      "AuxVersionPageResponse": Models.AuxVersionPageResponse;
      "AuxAuditEventPage": Models.AuxAuditEventPage;
      "AuxAuditEventPageResponse": Models.AuxAuditEventPageResponse;
      "PartyQueryRequest": Models.PartyQueryRequest;
      "PartyListItem": Models.PartyListItem;
      "PartyQueryResponse": Models.PartyQueryResponse;
      "PartyGetRequest": Models.PartyGetRequest;
      "PartyView": Models.PartyView;
      "PartyGetResponse": Models.PartyGetResponse;
      "BobGetRequest": Models.BobGetRequest;
      "CustomerQueryRequest": Models.CustomerQueryRequest;
      "CustomerListItem": Models.CustomerListItem;
      "CustomerQueryResponse": Models.CustomerQueryResponse;
      "CustomerPricingCostItem": Models.CustomerPricingCostItem;
      "CustomerPricingPolicy": Models.CustomerPricingPolicy;
      "CustomerCreditLimit": Models.CustomerCreditLimit;
      "CustomerSnapshot": Models.CustomerSnapshot;
      "CustomerSalesAttributionView": Models.CustomerSalesAttributionView;
      "CustomerAccountDataView": Models.CustomerAccountDataView;
      "CustomerAttachmentView": Models.CustomerAttachmentView;
      "CustomerVersionView": Models.CustomerVersionView;
      "CustomerAccountView": Models.CustomerAccountView;
      "CustomerDetailView": Models.CustomerDetailView;
      "CustomerGetResponse": Models.CustomerGetResponse;
      "CustomerSalesAttributionInput": Models.CustomerSalesAttributionInput;
      "CustomerAccountInput": Models.CustomerAccountInput;
      "CustomerCreateRequest": Models.CustomerCreateRequest;
      "BobMutationResult": Models.BobMutationResult;
      "CustomerCreateResult": Models.CustomerCreateResult;
      "CustomerCreateResponse": Models.CustomerCreateResponse;
      "CustomerAccountAddRequest": Models.CustomerAccountAddRequest;
      "CustomerAccountResponse": Models.CustomerAccountResponse;
      "BobDeleteRequest": Models.BobDeleteRequest;
      "CustomerSaveRequest": Models.CustomerSaveRequest;
      "BobMutationResponse": Models.BobMutationResponse;
      "CustomerAttachmentScope": Models.CustomerAttachmentScope;
      "CustomerAttachmentInitiateRequest": Models.CustomerAttachmentInitiateRequest;
      "CustomerAttachmentInitiateResult": Models.CustomerAttachmentInitiateResult;
      "CustomerAttachmentInitiateResponse": Models.CustomerAttachmentInitiateResponse;
      "CustomerAttachmentDownloadRequest": Models.CustomerAttachmentDownloadRequest;
      "CustomerAttachmentDownloadResult": Models.CustomerAttachmentDownloadResult;
      "CustomerAttachmentDownloadResponse": Models.CustomerAttachmentDownloadResponse;
      "CustomerAttachmentRemoveRequest": Models.CustomerAttachmentRemoveRequest;
      "CustomerAttachmentMutationResult": Models.CustomerAttachmentMutationResult;
      "CustomerAttachmentRemoveResponse": Models.CustomerAttachmentRemoveResponse;
      "SupplierListVersion": Models.SupplierListVersion;
      "SupplierListItem": Models.SupplierListItem;
      "SupplierQueryResponse": Models.SupplierQueryResponse;
      "SupplierView": Models.SupplierView;
      "SupplierVersionView": Models.SupplierVersionView;
      "SupplierDetailView": Models.SupplierDetailView;
      "SupplierGetResponse": Models.SupplierGetResponse;
      "BobReferenceQueryRequest": Models.BobReferenceQueryRequest;
      "ReferenceCandidate": Models.ReferenceCandidate;
      "ReferenceQueryResponse": Models.ReferenceQueryResponse;
      "AuxReferenceQueryRequest": Models.AuxReferenceQueryRequest;
      "BobReadableEntity": Models.BobReadableEntity;
      "BobQueryRequest": Models.BobQueryRequest;
      "BobVersionSummary": Models.BobVersionSummary;
      "BobListItem": Models.BobListItem;
      "BobListPage": Models.BobListPage;
      "BobQueryResponse": Models.BobQueryResponse;
      "data": Models.data;
      "BobDetailView": Models.BobDetailView;
      "BobRelationshipIdentityView": Models.BobRelationshipIdentityView;
      "BobObjectView": Models.BobObjectView;
      "BobObjectResponse": Models.BobObjectResponse;
      "BobLifecycleEntity": Models.BobLifecycleEntity;
      "BobVersionRevisionRequest": Models.BobVersionRevisionRequest;
      "BobReviewRequest": Models.BobReviewRequest;
      "BobActiveReferenceCount": Models.BobActiveReferenceCount;
      "BobActiveReferenceBlockers": Models.BobActiveReferenceBlockers;
      "BobUnapproveResponse": Models.BobUnapproveResponse;
      "BobObjectRevisionRequest": Models.BobObjectRevisionRequest;
      "BobDisableResponse": Models.BobDisableResponse;
      "BobHistoryRequest": Models.BobHistoryRequest;
      "BobVersionHistoryItem": Models.BobVersionHistoryItem;
      "BobVersionHistoryPage": Models.BobVersionHistoryPage;
      "BobVersionHistoryResponse": Models.BobVersionHistoryResponse;
      "BobAuditEventPage": Models.BobAuditEventPage;
      "BobAuditHistoryResponse": Models.BobAuditHistoryResponse;
      "VouQueryRequest": Models.VouQueryRequest;
      "VouSalesBaseQuantitySummary": Models.VouSalesBaseQuantitySummary;
      "VouPurchaseBaseQuantitySummary": Models.VouPurchaseBaseQuantitySummary;
      "VouListItem": Models.VouListItem;
      "VouListPage": Models.VouListPage;
      "VouQueryResponse": Models.VouQueryResponse;
      "VouGetRequest": Models.VouGetRequest;
      "BusinessEnvelope": Models.BusinessEnvelope;
      "VouUnitSnapshotView": Models.VouUnitSnapshotView;
      "VouReferenceView": Models.VouReferenceView;
      "VouQuantitySnapshotView": Models.VouQuantitySnapshotView;
      "VouFormulaView": Models.VouFormulaView;
      "VouProductLineView": Models.VouProductLineView;
      "VouPriceLineView": Models.VouPriceLineView;
      "VouExpenseLineView": Models.VouExpenseLineView;
      "VouManagedLineView": Models.VouManagedLineView;
      "VouProductionMaterialView": Models.VouProductionMaterialView;
      "VouProductionOutputView": Models.VouProductionOutputView;
      "VouInventoryCountLineView": Models.VouInventoryCountLineView;
      "VouAssetLineView": Models.VouAssetLineView;
      "VouIntermediaryReference": Models.VouIntermediaryReference;
      "VouIntermediarySalesContractSnapshot": Models.VouIntermediarySalesContractSnapshot;
      "VouIntermediarySourceLine": Models.VouIntermediarySourceLine;
      "VouIntermediarySourceBill": Models.VouIntermediarySourceBill;
      "VouIntermediaryCalculationSource": Models.VouIntermediaryCalculationSource;
      "VouIntermediaryScriptSnapshot": Models.VouIntermediaryScriptSnapshot;
      "VouIntermediaryResultLine": Models.VouIntermediaryResultLine;
      "VouIntermediarySummary": Models.VouIntermediarySummary;
      "VouIntermediaryCalculationResult": Models.VouIntermediaryCalculationResult;
      "VouIntermediaryCalculationInput": Models.VouIntermediaryCalculationInput;
      "VouSettlementMethodSnapshotView": Models.VouSettlementMethodSnapshotView;
      "VouServiceContractView": Models.VouServiceContractView;
      "VouServiceAcceptanceView": Models.VouServiceAcceptanceView;
      "VouSaleSignoffLineView": Models.VouSaleSignoffLineView;
      "VouBillLineView": Models.VouBillLineView;
      "VouBillReferenceView": Models.VouBillReferenceView;
      "VouBillCashLineView": Models.VouBillCashLineView;
      "VouDocumentDataView": Models.VouDocumentDataView;
      "VouAttachmentView": Models.VouAttachmentView;
      "VouDocumentView": Models.VouDocumentView;
      "VouDocumentResponse": Models.VouDocumentResponse;
      "VouIntermediarySourceRequest": Models.VouIntermediarySourceRequest;
      "VouIntermediarySourceResponse": Models.VouIntermediarySourceResponse;
      "VouIntermediaryScriptGetResponse": Models.VouIntermediaryScriptGetResponse;
      "VouIntermediaryScriptSaveRequest": Models.VouIntermediaryScriptSaveRequest;
      "VouInventoryCountBalanceRequest": Models.VouInventoryCountBalanceRequest;
      "VouInventoryCountBalancePage": Models.VouInventoryCountBalancePage;
      "VouInventoryCountBalanceResponse": Models.VouInventoryCountBalanceResponse;
      "VouAvailableBillQueryRequest": Models.VouAvailableBillQueryRequest;
      "VouAvailableBillItem": Models.VouAvailableBillItem;
      "VouAvailableBillQueryResponse": Models.VouAvailableBillQueryResponse;
      "VouAvailableAssetQueryRequest": Models.VouAvailableAssetQueryRequest;
      "VouAvailableAssetItem": Models.VouAvailableAssetItem;
      "VouAvailableAssetQueryResponse": Models.VouAvailableAssetQueryResponse;
      "VouFormulaDefaultRequest": Models.VouFormulaDefaultRequest;
      "VouFormulaDefaultView": Models.VouFormulaDefaultView;
      "VouFormulaDefaultResponse": Models.VouFormulaDefaultResponse;
      "VouPriceReferenceRequest": Models.VouPriceReferenceRequest;
      "VouPriceReferenceResponse": Models.VouPriceReferenceResponse;
      "VouCreatableEntity": Models.VouCreatableEntity;
      "VouServiceContractInput": Models.VouServiceContractInput;
      "VouServiceAcceptanceInput": Models.VouServiceAcceptanceInput;
      "VouProductionMaterialInput": Models.VouProductionMaterialInput;
      "VouProductionOutputInput": Models.VouProductionOutputInput;
      "VouAssetReferenceInput": Models.VouAssetReferenceInput;
      "VouAssetAcquisitionLineInput": Models.VouAssetAcquisitionLineInput;
      "VouAssetSaleLineInput": Models.VouAssetSaleLineInput;
      "VouAssetLiquidationLineInput": Models.VouAssetLiquidationLineInput;
      "VouBillPrimaryLineInput": Models.VouBillPrimaryLineInput;
      "VouBillChangeLineInput": Models.VouBillChangeLineInput;
      "VouBillPaymentLineInput": Models.VouBillPaymentLineInput;
      "VouBillIssueLineInput": Models.VouBillIssueLineInput;
      "VouBillDiscountLineInput": Models.VouBillDiscountLineInput;
      "VouBillMaturityLineInput": Models.VouBillMaturityLineInput;
      "VouBillLineInput": Models.VouBillLineInput;
      "VouBillCashLineInput": Models.VouBillCashLineInput;
      "VouQuantitySnapshotInput": Models.VouQuantitySnapshotInput;
      "VouFormulaComponentInput": Models.VouFormulaComponentInput;
      "VouFormulaInput": Models.VouFormulaInput;
      "VouPriceLineInput": Models.VouPriceLineInput;
      "VouInventoryCountLineInput": Models.VouInventoryCountLineInput;
      "VouCreateRequest": Models.VouCreateRequest;
      "VouMutationResult": Models.VouMutationResult;
      "VouMutationResponse": Models.VouMutationResponse;
      "VouSaveRequest": Models.VouSaveRequest;
      "VouReverseRequest": Models.VouReverseRequest;
      "VouDocumentRevisionRequest": Models.VouDocumentRevisionRequest;
      "VouHistoryRequest": Models.VouHistoryRequest;
      "VouAuditHistoryResponse": Models.VouAuditHistoryResponse;
      "VouAttachmentInitiateRequest": Models.VouAttachmentInitiateRequest;
      "VouAttachmentInitiateResult": Models.VouAttachmentInitiateResult;
      "VouAttachmentInitiateResponse": Models.VouAttachmentInitiateResponse;
      "VouAttachmentDownloadRequest": Models.VouAttachmentDownloadRequest;
      "VouAttachmentDownloadResult": Models.VouAttachmentDownloadResult;
      "VouAttachmentDownloadResponse": Models.VouAttachmentDownloadResponse;
      "VouAttachmentRemoveRequest": Models.VouAttachmentRemoveRequest;
      "WflDefinitionQueryRequest": Models.WflDefinitionQueryRequest;
      "WflDefinitionListItem": Models.WflDefinitionListItem;
      "WflDefinitionQueryResponse": Models.WflDefinitionQueryResponse;
      "WflDefinitionGetRequest": Models.WflDefinitionGetRequest;
      "WflDefinitionDiagnostic": Models.WflDefinitionDiagnostic;
      "WflDefinitionNode": Models.WflDefinitionNode;
      "WflDefinitionEdge": Models.WflDefinitionEdge;
      "WflDefinitionView": Models.WflDefinitionView;
      "WflDefinitionViewResponse": Models.WflDefinitionViewResponse;
      "WflDefinitionCreateRequest": Models.WflDefinitionCreateRequest;
      "WflDefinitionSaveRequest": Models.WflDefinitionSaveRequest;
      "WflDefinitionTrialRequest": Models.WflDefinitionTrialRequest;
      "WflBusinessObjectReference": Models.WflBusinessObjectReference;
      "WflExecutionTrace": Models.WflExecutionTrace;
      "WflPlannedAction": Models.WflPlannedAction;
      "WflDefinitionTrialResult": Models.WflDefinitionTrialResult;
      "WflDefinitionTrialResponse": Models.WflDefinitionTrialResponse;
      "WflDefinitionVersionCreateRequest": Models.WflDefinitionVersionCreateRequest;
      "WflDefinitionVersionsRequest": Models.WflDefinitionVersionsRequest;
      "WflDefinitionActionRequest": Models.WflDefinitionActionRequest;
      "WflDefinitionDeleteResult": Models.WflDefinitionDeleteResult;
      "WflDefinitionDeleteResponse": Models.WflDefinitionDeleteResponse;
      "WflDefinitionReasonActionRequest": Models.WflDefinitionReasonActionRequest;
      "WflDefinitionToggleRequest": Models.WflDefinitionToggleRequest;
      "WflInstanceQueryRequest": Models.WflInstanceQueryRequest;
      "WflInstanceListItem": Models.WflInstanceListItem;
      "WflInstancePage": Models.WflInstancePage;
      "WflInstanceQueryResponse": Models.WflInstanceQueryResponse;
      "WflInstanceGetRequest": Models.WflInstanceGetRequest;
      "WflNodeInstance": Models.WflNodeInstance;
      "WflAvailableChildTarget": Models.WflAvailableChildTarget;
      "WflInstanceView": Models.WflInstanceView;
      "WflInstanceViewResponse": Models.WflInstanceViewResponse;
      "WflInstanceHistoryRequest": Models.WflInstanceHistoryRequest;
      "WflRuntimeAuditView": Models.WflRuntimeAuditView;
      "WflRuntimeAuditPage": Models.WflRuntimeAuditPage;
      "WflInstanceHistoryResponse": Models.WflInstanceHistoryResponse;
      "WflCreateChildRequest": Models.WflCreateChildRequest;
      "WflCreateChildResponse": Models.WflCreateChildResponse;
      "RptDefinitionQueryRequest": Models.RptDefinitionQueryRequest;
      "RptParameterType": Models.RptParameterType;
      "RptReferenceType": Models.RptReferenceType;
      "RptParameter": Models.RptParameter;
      "RptResultType": Models.RptResultType;
      "RptResultColumn": Models.RptResultColumn;
      "RptVersionData": Models.RptVersionData;
      "RptDefinitionViewData": Models.RptDefinitionViewData;
      "RptDefinitionPageData": Models.RptDefinitionPageData;
      "RptDefinitionPageResponse": Models.RptDefinitionPageResponse;
      "RptDefinitionGetRequest": Models.RptDefinitionGetRequest;
      "RptDefinitionViewResponse": Models.RptDefinitionViewResponse;
      "RptDefinitionCreateRequest": Models.RptDefinitionCreateRequest;
      "RptVersionCreateRequest": Models.RptVersionCreateRequest;
      "RptVersionSaveRequest": Models.RptVersionSaveRequest;
      "RptVersionListRequest": Models.RptVersionListRequest;
      "RptDefinitionVersionPageData": Models.RptDefinitionVersionPageData;
      "RptDefinitionVersionPageResponse": Models.RptDefinitionVersionPageResponse;
      "RptVersionDeleteRequest": Models.RptVersionDeleteRequest;
      "RptVersionActionRequest": Models.RptVersionActionRequest;
      "RptVersionReasonActionRequest": Models.RptVersionReasonActionRequest;
      "RptDefinitionRevisionRequest": Models.RptDefinitionRevisionRequest;
      "RptExecuteRequest": Models.RptExecuteRequest;
      "RptQueryResult": Models.RptQueryResult;
      "RptQueryResponse": Models.RptQueryResponse;
      "RptDirectoryQueryRequest": Models.RptDirectoryQueryRequest;
      "RptReportMetadata": Models.RptReportMetadata;
      "RptDirectoryPageData": Models.RptDirectoryPageData;
      "RptDirectoryPageResponse": Models.RptDirectoryPageResponse;
      "RptReferenceQueryRequest": Models.RptReferenceQueryRequest;
      "RptReferenceItem": Models.RptReferenceItem;
      "RptReferencePageData": Models.RptReferencePageData;
      "RptReferencePageResponse": Models.RptReferencePageResponse;
      "TechnicalError": Models.TechnicalError;
      "HealthResponse": Models.HealthResponse;
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
