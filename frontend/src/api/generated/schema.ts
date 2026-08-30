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
      responses: { 200: { content: { 'application/json': Models.DclRelationshipMutationResponse } } };
    };
  };
  "/dcl/other-unit/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOtherUnitSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRelationshipMutationResponse } } };
    };
  };
  "/dcl/other-unit/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRelationshipMutationResponse } } };
    };
  };
  "/dcl/other-unit/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRelationshipMutationResponse } } };
    };
  };
  "/dcl/other-unit/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRelationshipMutationResponse } } };
    };
  };
  "/dcl/other-unit/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRelationshipMutationResponse } } };
    };
  };
  "/dcl/other-unit/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRelationshipMutationResponse } } };
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
      responses: { 200: { content: { 'application/json': Models.DclOtherUnitViewResponse } } };
    };
  };
  "/dcl/other-unit/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclRelationshipQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOtherUnitQueryResponse } } };
    };
  };
  "/dcl/other-unit/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOtherUnitVersionPageResponse } } };
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
  "/dcl/customer/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclCustomerQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclCustomerQueryResponse } } };
    };
  };
  "/dcl/customer/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityGetRequest } };
      responses: { 200: { content: { 'application/json': Models.DclCustomerViewResponse } } };
    };
  };
  "/dcl/customer/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclCustomerCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/customer/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclCustomerSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/customer/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/customer/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/customer/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/customer/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/customer/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/customer/delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/customer/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclCustomerVersionPageResponse } } };
    };
  };
  "/dcl/customer/audit-history": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityAuditHistoryResponse } } };
    };
  };
  "/dcl/customer-account/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclCustomerAccountQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclCustomerAccountQueryResponse } } };
    };
  };
  "/dcl/customer-account/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityGetRequest } };
      responses: { 200: { content: { 'application/json': Models.DclCustomerAccountViewResponse } } };
    };
  };
  "/dcl/customer-account/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclCustomerAccountCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/customer-account/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclCustomerAccountSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/customer-account/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/customer-account/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/customer-account/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/customer-account/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/customer-account/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/customer-account/delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityMutationResponse } } };
    };
  };
  "/dcl/customer-account/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclCustomerAccountVersionPageResponse } } };
    };
  };
  "/dcl/customer-account/audit-history": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclOperatingEntityAuditHistoryResponse } } };
    };
  };
  "/dcl/customer/attachment-initiate": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclCustomerAttachmentInitiateRequest } };
      responses: { 200: { content: { 'application/json': Models.DclCustomerAttachmentInitiateResponse } } };
    };
  };
  "/dcl/customer/attachment-download": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclCustomerAttachmentDownloadRequest } };
      responses: { 200: { content: { 'application/json': Models.DclCustomerAttachmentDownloadResponse } } };
    };
  };
  "/dcl/customer/attachment-remove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclCustomerAttachmentRemoveRequest } };
      responses: { 200: { content: { 'application/json': Models.DclCustomerAttachmentRemoveResponse } } };
    };
  };
  "/dcl/supplier/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclSupplierQueryRequest } };
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
      responses: { 200: { content: { 'application/json': Models.DclRelationshipMutationResponse } } };
    };
  };
  "/dcl/sales-partner/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclSalesPartnerSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRelationshipMutationResponse } } };
    };
  };
  "/dcl/sales-partner/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRelationshipMutationResponse } } };
    };
  };
  "/dcl/sales-partner/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRelationshipMutationResponse } } };
    };
  };
  "/dcl/sales-partner/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRelationshipMutationResponse } } };
    };
  };
  "/dcl/sales-partner/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRelationshipMutationResponse } } };
    };
  };
  "/dcl/sales-partner/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRelationshipMutationResponse } } };
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
      responses: { 200: { content: { 'application/json': Models.DclSalesPartnerViewResponse } } };
    };
  };
  "/dcl/sales-partner/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclRelationshipQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclSalesPartnerQueryResponse } } };
    };
  };
  "/dcl/sales-partner/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclOperatingEntityHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclSalesPartnerVersionPageResponse } } };
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
      responses: { 200: { content: { 'application/json': Models.DclPartyUnapproveResponse } } };
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
  "/dcl/acc-mapping/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclAccMappingCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.DclAccMappingMutationResponse } } };
    };
  };
  "/dcl/acc-mapping/create-next": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclAccMappingVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclAccMappingMutationResponse } } };
    };
  };
  "/dcl/acc-mapping/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclAccMappingSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.DclAccMappingSaveResponse } } };
    };
  };
  "/dcl/acc-mapping/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclAccMappingVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclAccMappingMutationResponse } } };
    };
  };
  "/dcl/acc-mapping/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclAccMappingReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclAccMappingMutationResponse } } };
    };
  };
  "/dcl/acc-mapping/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclAccMappingReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclAccMappingMutationResponse } } };
    };
  };
  "/dcl/acc-mapping/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclAccMappingVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclAccMappingMutationResponse } } };
    };
  };
  "/dcl/acc-mapping/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclAccMappingReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclAccMappingMutationResponse } } };
    };
  };
  "/dcl/acc-mapping/delete-version": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclAccMappingVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
    };
  };
  "/dcl/acc-mapping/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclAccMappingQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclAccMappingQueryResponse } } };
    };
  };
  "/dcl/acc-mapping/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclAccMappingGetRequest } };
      responses: { 200: { content: { 'application/json': Models.DclAccMappingViewResponse } } };
    };
  };
  "/dcl/acc-mapping/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclAccMappingHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclAccMappingVersionPageResponse } } };
    };
  };
  "/dcl/acc-mapping/audit-history": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclAccMappingHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseAuditHistoryResponse } } };
    };
  };
  "/dcl/rpt-definition/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclRptDefinitionCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRptDefinitionMutationResponse } } };
    };
  };
  "/dcl/rpt-definition/create-next": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclRptDefinitionVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRptDefinitionMutationResponse } } };
    };
  };
  "/dcl/rpt-definition/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclRptDefinitionSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRptDefinitionMutationResponse } } };
    };
  };
  "/dcl/rpt-definition/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclRptDefinitionVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRptDefinitionMutationResponse } } };
    };
  };
  "/dcl/rpt-definition/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclRptDefinitionReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRptDefinitionMutationResponse } } };
    };
  };
  "/dcl/rpt-definition/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclRptDefinitionReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRptDefinitionMutationResponse } } };
    };
  };
  "/dcl/rpt-definition/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclRptDefinitionVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRptDefinitionMutationResponse } } };
    };
  };
  "/dcl/rpt-definition/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclRptDefinitionReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRptDefinitionMutationResponse } } };
    };
  };
  "/dcl/rpt-definition/delete-version": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclRptDefinitionDeleteRequest } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
    };
  };
  "/dcl/rpt-definition/enable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclRptDefinitionEnableRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRptDefinitionMutationResponse } } };
    };
  };
  "/dcl/rpt-definition/disable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclRptDefinitionEnableRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRptDefinitionMutationResponse } } };
    };
  };
  "/dcl/rpt-definition/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclRptDefinitionQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRptDefinitionQueryResponse } } };
    };
  };
  "/dcl/rpt-definition/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclRptDefinitionGetRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRptDefinitionViewResponse } } };
    };
  };
  "/dcl/rpt-definition/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclRptDefinitionHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclRptDefinitionVersionPageResponse } } };
    };
  };
  "/dcl/rpt-definition/audit-history": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclRptDefinitionHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseAuditHistoryResponse } } };
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
      requestBody: { content: { 'application/json': Models.AuxObjectRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
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
      requestBody: { content: { 'application/json': Models.BobQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.BobQueryResponse } } };
    };
  };
  "/bob/other-unit/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobGetRequest } };
      responses: { 200: { content: { 'application/json': Models.BobObjectResponse } } };
    };
  };
  "/bob/customer/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobCustomerQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.BobCustomerQueryResponse } } };
    };
  };
  "/bob/customer/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobGetRequest } };
      responses: { 200: { content: { 'application/json': Models.BobCustomerGetResponse } } };
    };
  };
  "/bob/customer-account/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobCustomerAccountQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.BobCustomerAccountQueryResponse } } };
    };
  };
  "/bob/customer-account/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobGetRequest } };
      responses: { 200: { content: { 'application/json': Models.BobCustomerAccountGetResponse } } };
    };
  };
  "/bob/supplier/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.BobQueryResponse } } };
    };
  };
  "/bob/supplier/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobGetRequest } };
      responses: { 200: { content: { 'application/json': Models.BobObjectResponse } } };
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
      responses: { 200: { content: { 'application/json': Models.AuxReferenceQueryResponse } } };
    };
  };
  "/bob/sales-partner/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.BobQueryResponse } } };
    };
  };
  "/bob/sales-partner/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobGetRequest } };
      responses: { 200: { content: { 'application/json': Models.BobObjectResponse } } };
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
  "/dcl/wfl-process-definition/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclWflProcessDefinitionCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWflProcessDefinitionMutationResponse } } };
    };
  };
  "/dcl/wfl-process-definition/create-next": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclWflProcessDefinitionVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWflProcessDefinitionMutationResponse } } };
    };
  };
  "/dcl/wfl-process-definition/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclWflProcessDefinitionSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWflProcessDefinitionViewResponse } } };
    };
  };
  "/dcl/wfl-process-definition/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclWflProcessDefinitionVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWflProcessDefinitionMutationResponse } } };
    };
  };
  "/dcl/wfl-process-definition/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclWflProcessDefinitionVersionRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWflProcessDefinitionMutationResponse } } };
    };
  };
  "/dcl/wfl-process-definition/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclWflProcessDefinitionReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWflProcessDefinitionMutationResponse } } };
    };
  };
  "/dcl/wfl-process-definition/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclWflProcessDefinitionReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWflProcessDefinitionMutationResponse } } };
    };
  };
  "/dcl/wfl-process-definition/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclWflProcessDefinitionReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWflProcessDefinitionMutationResponse } } };
    };
  };
  "/dcl/wfl-process-definition/delete-version": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclWflProcessDefinitionDeleteRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWflProcessDefinitionMutationResponse } } };
    };
  };
  "/dcl/wfl-process-definition/enable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclWflProcessDefinitionEnableRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWflProcessDefinitionMutationResponse } } };
    };
  };
  "/dcl/wfl-process-definition/disable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclWflProcessDefinitionEnableRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWflProcessDefinitionMutationResponse } } };
    };
  };
  "/dcl/wfl-process-definition/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclWflProcessDefinitionQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWflProcessDefinitionQueryResponse } } };
    };
  };
  "/dcl/wfl-process-definition/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclWflProcessDefinitionGetRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWflProcessDefinitionViewResponse } } };
    };
  };
  "/dcl/wfl-process-definition/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclWflProcessDefinitionHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWflProcessDefinitionVersionPageResponse } } };
    };
  };
  "/dcl/wfl-process-definition/audit-history": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.DclWflProcessDefinitionHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.DclWarehouseAuditHistoryResponse } } };
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
  "/wfl/process-definition/trial": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflDefinitionTrialRequest } };
      responses: { 200: { content: { 'application/json': Models.WflDefinitionTrialResponse } } };
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
      "DclMeasurementUnitReferenceInput": Models.DclMeasurementUnitReferenceInput;
      "DclProductUnitConversionInput": Models.DclProductUnitConversionInput;
      "DclProductQuantityInput": Models.DclProductQuantityInput;
      "DclProductFormulaComponentInput": Models.DclProductFormulaComponentInput;
      "DclProductFormulaInput": Models.DclProductFormulaInput;
      "DclProductInput": Models.DclProductInput;
      "DclProductCreateRequest": Models.DclProductCreateRequest;
      "DclProductSaveRequest": Models.DclProductSaveRequest;
      "BobMeasurementUnitSnapshot": Models.BobMeasurementUnitSnapshot;
      "BobProductUnitConversion": Models.BobProductUnitConversion;
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
      "DclRelationshipMutation": Models.DclRelationshipMutation;
      "DclRelationshipMutationResponse": Models.DclRelationshipMutationResponse;
      "DclOtherUnitSaveRequest": Models.DclOtherUnitSaveRequest;
      "DclRelationshipListIdentity": Models.DclRelationshipListIdentity;
      "DclOtherUnitData": Models.DclOtherUnitData;
      "DclOtherUnitView": Models.DclOtherUnitView;
      "DclOtherUnitViewResponse": Models.DclOtherUnitViewResponse;
      "DclRelationshipQueryRequest": Models.DclRelationshipQueryRequest;
      "DclOtherUnitVersionView": Models.DclOtherUnitVersionView;
      "DclOtherUnitListItem": Models.DclOtherUnitListItem;
      "DclOtherUnitQueryPage": Models.DclOtherUnitQueryPage;
      "DclOtherUnitQueryResponse": Models.DclOtherUnitQueryResponse;
      "DclOtherUnitVersionPage": Models.DclOtherUnitVersionPage;
      "DclOtherUnitVersionPageResponse": Models.DclOtherUnitVersionPageResponse;
      "DclCustomerQueryRequest": Models.DclCustomerQueryRequest;
      "DclCustomerAttachmentView": Models.DclCustomerAttachmentView;
      "DclCustomerVersionView": Models.DclCustomerVersionView;
      "DclCustomerListItem": Models.DclCustomerListItem;
      "DclCustomerQueryPage": Models.DclCustomerQueryPage;
      "DclCustomerQueryResponse": Models.DclCustomerQueryResponse;
      "DclCustomerView": Models.DclCustomerView;
      "DclCustomerViewResponse": Models.DclCustomerViewResponse;
      "DclCustomerPricingCostItem": Models.DclCustomerPricingCostItem;
      "DclCustomerPricingPolicy": Models.DclCustomerPricingPolicy;
      "DclCustomerCreditLimit": Models.DclCustomerCreditLimit;
      "DclCustomerSalesAttributionInput": Models.DclCustomerSalesAttributionInput;
      "DclCustomerAccountInput": Models.DclCustomerAccountInput;
      "DclCustomerCreateRequest": Models.DclCustomerCreateRequest;
      "DclCustomerSaveRequest": Models.DclCustomerSaveRequest;
      "DclCustomerVersionPage": Models.DclCustomerVersionPage;
      "DclCustomerVersionPageResponse": Models.DclCustomerVersionPageResponse;
      "DclCustomerAccountQueryRequest": Models.DclCustomerAccountQueryRequest;
      "DclCustomerAuxiliarySnapshot": Models.DclCustomerAuxiliarySnapshot;
      "DclCustomerSnapshot": Models.DclCustomerSnapshot;
      "DclCustomerSalesAttributionSnapshot": Models.DclCustomerSalesAttributionSnapshot;
      "DclCustomerAccountData": Models.DclCustomerAccountData;
      "DclCustomerAccountVersionView": Models.DclCustomerAccountVersionView;
      "DclCustomerAccountListItem": Models.DclCustomerAccountListItem;
      "DclCustomerAccountQueryPage": Models.DclCustomerAccountQueryPage;
      "DclCustomerAccountQueryResponse": Models.DclCustomerAccountQueryResponse;
      "DclCustomerAccountView": Models.DclCustomerAccountView;
      "DclCustomerAccountViewResponse": Models.DclCustomerAccountViewResponse;
      "DclCustomerAccountCreateRequest": Models.DclCustomerAccountCreateRequest;
      "DclCustomerAccountSaveRequest": Models.DclCustomerAccountSaveRequest;
      "DclCustomerAccountVersionPage": Models.DclCustomerAccountVersionPage;
      "DclCustomerAccountVersionPageResponse": Models.DclCustomerAccountVersionPageResponse;
      "DclCustomerAttachmentScope": Models.DclCustomerAttachmentScope;
      "DclCustomerAttachmentInitiateRequest": Models.DclCustomerAttachmentInitiateRequest;
      "DclCustomerAttachmentInitiateResult": Models.DclCustomerAttachmentInitiateResult;
      "DclCustomerAttachmentInitiateResponse": Models.DclCustomerAttachmentInitiateResponse;
      "DclCustomerAttachmentDownloadRequest": Models.DclCustomerAttachmentDownloadRequest;
      "DclCustomerAttachmentDownloadResult": Models.DclCustomerAttachmentDownloadResult;
      "DclCustomerAttachmentDownloadResponse": Models.DclCustomerAttachmentDownloadResponse;
      "DclCustomerAttachmentRemoveRequest": Models.DclCustomerAttachmentRemoveRequest;
      "DclCustomerAttachmentMutationResult": Models.DclCustomerAttachmentMutationResult;
      "DclCustomerAttachmentRemoveResponse": Models.DclCustomerAttachmentRemoveResponse;
      "DclSupplierQueryRequest": Models.DclSupplierQueryRequest;
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
      "DclSalesPartnerView": Models.DclSalesPartnerView;
      "DclSalesPartnerViewResponse": Models.DclSalesPartnerViewResponse;
      "DclSalesPartnerVersionView": Models.DclSalesPartnerVersionView;
      "DclSalesPartnerListItem": Models.DclSalesPartnerListItem;
      "DclSalesPartnerQueryPage": Models.DclSalesPartnerQueryPage;
      "DclSalesPartnerQueryResponse": Models.DclSalesPartnerQueryResponse;
      "DclSalesPartnerVersionPage": Models.DclSalesPartnerVersionPage;
      "DclSalesPartnerVersionPageResponse": Models.DclSalesPartnerVersionPageResponse;
      "DclPartyData": Models.DclPartyData;
      "DclPartySaveRequest": Models.DclPartySaveRequest;
      "DclPartyMutation": Models.DclPartyMutation;
      "DclPartyMutationResponse": Models.DclPartyMutationResponse;
      "DclPartyVersionRequest": Models.DclPartyVersionRequest;
      "DclPartyReviewRequest": Models.DclPartyReviewRequest;
      "DclPartyReferenceCount": Models.DclPartyReferenceCount;
      "DclPartyUnapproveBlockers": Models.DclPartyUnapproveBlockers;
      "DclPartyUnapproveResponse": Models.DclPartyUnapproveResponse;
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
      "DclAccMappingData": Models.DclAccMappingData;
      "DclAccMappingCreateRequest": Models.DclAccMappingCreateRequest;
      "DclAccMappingMutation": Models.DclAccMappingMutation;
      "DclAccMappingMutationResponse": Models.DclAccMappingMutationResponse;
      "DclAccMappingVersionRequest": Models.DclAccMappingVersionRequest;
      "DclAccMappingSaveRequest": Models.DclAccMappingSaveRequest;
      "DclAccMappingView": Models.DclAccMappingView;
      "DclAccMappingSaveResponse": Models.DclAccMappingSaveResponse;
      "DclAccMappingReviewRequest": Models.DclAccMappingReviewRequest;
      "DclAccMappingQueryRequest": Models.DclAccMappingQueryRequest;
      "DclAccMappingListItem": Models.DclAccMappingListItem;
      "DclAccMappingQueryPage": Models.DclAccMappingQueryPage;
      "DclAccMappingQueryResponse": Models.DclAccMappingQueryResponse;
      "DclAccMappingGetRequest": Models.DclAccMappingGetRequest;
      "DclAccMappingViewResponse": Models.DclAccMappingViewResponse;
      "DclAccMappingHistoryRequest": Models.DclAccMappingHistoryRequest;
      "DclAccMappingVersionPage": Models.DclAccMappingVersionPage;
      "DclAccMappingVersionPageResponse": Models.DclAccMappingVersionPageResponse;
      "RptParameterType": Models.RptParameterType;
      "RptReferenceType": Models.RptReferenceType;
      "RptParameter": Models.RptParameter;
      "RptResultType": Models.RptResultType;
      "RptResultColumn": Models.RptResultColumn;
      "RptVersionData": Models.RptVersionData;
      "DclRptDefinitionCreateRequest": Models.DclRptDefinitionCreateRequest;
      "DclRptDefinitionMutation": Models.DclRptDefinitionMutation;
      "DclRptDefinitionMutationResponse": Models.DclRptDefinitionMutationResponse;
      "DclRptDefinitionVersionRequest": Models.DclRptDefinitionVersionRequest;
      "DclRptDefinitionSaveRequest": Models.DclRptDefinitionSaveRequest;
      "DclRptDefinitionReviewRequest": Models.DclRptDefinitionReviewRequest;
      "DclRptDefinitionDeleteRequest": Models.DclRptDefinitionDeleteRequest;
      "DclRptDefinitionEnableRequest": Models.DclRptDefinitionEnableRequest;
      "DclRptDefinitionQueryRequest": Models.DclRptDefinitionQueryRequest;
      "DclRptDefinitionVersionSummary": Models.DclRptDefinitionVersionSummary;
      "DclRptDefinitionListItem": Models.DclRptDefinitionListItem;
      "DclRptDefinitionQueryPageData": Models.DclRptDefinitionQueryPageData;
      "DclRptDefinitionQueryResponse": Models.DclRptDefinitionQueryResponse;
      "DclRptDefinitionGetRequest": Models.DclRptDefinitionGetRequest;
      "DclRptDefinitionView": Models.DclRptDefinitionView;
      "DclRptDefinitionViewResponse": Models.DclRptDefinitionViewResponse;
      "DclRptDefinitionHistoryRequest": Models.DclRptDefinitionHistoryRequest;
      "DclRptDefinitionVersionView": Models.DclRptDefinitionVersionView;
      "DclRptDefinitionVersionPageData": Models.DclRptDefinitionVersionPageData;
      "DclRptDefinitionVersionPageResponse": Models.DclRptDefinitionVersionPageResponse;
      "WorkbenchCategory": Models.WorkbenchCategory;
      "WorkbenchPendingStage": Models.WorkbenchPendingStage;
      "WorkbenchQueryRequest": Models.WorkbenchQueryRequest;
      "WorkbenchObjectEntity": Models.WorkbenchObjectEntity;
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
      "AuxObjectRevisionRequest": Models.AuxObjectRevisionRequest;
      "PartyQueryRequest": Models.PartyQueryRequest;
      "PartyListItem": Models.PartyListItem;
      "PartyQueryResponse": Models.PartyQueryResponse;
      "PartyGetRequest": Models.PartyGetRequest;
      "PartyView": Models.PartyView;
      "PartyGetResponse": Models.PartyGetResponse;
      "BobQueryRequest": Models.BobQueryRequest;
      "BobEntity": Models.BobEntity;
      "BobQuantitySnapshot": Models.BobQuantitySnapshot;
      "BobProductFormulaComponent": Models.BobProductFormulaComponent;
      "BobProductFormula": Models.BobProductFormula;
      "BobDetailData": Models.BobDetailData;
      "BobDetailView": Models.BobDetailView;
      "BobRelationshipIdentityView": Models.BobRelationshipIdentityView;
      "BobListItem": Models.BobListItem;
      "BobListPage": Models.BobListPage;
      "BobQueryResponse": Models.BobQueryResponse;
      "BobGetRequest": Models.BobGetRequest;
      "BobObjectView": Models.BobObjectView;
      "BobObjectResponse": Models.BobObjectResponse;
      "BobCustomerQueryRequest": Models.BobCustomerQueryRequest;
      "BobCustomerListItem": Models.BobCustomerListItem;
      "BobCustomerQueryResponse": Models.BobCustomerQueryResponse;
      "BobCustomerCurrentView": Models.BobCustomerCurrentView;
      "BobCustomerGetResponse": Models.BobCustomerGetResponse;
      "BobCustomerAccountQueryRequest": Models.BobCustomerAccountQueryRequest;
      "BobCustomerAccountListItem": Models.BobCustomerAccountListItem;
      "BobCustomerAccountQueryResponse": Models.BobCustomerAccountQueryResponse;
      "BobCustomerAttachmentView": Models.BobCustomerAttachmentView;
      "BobCustomerAccountCurrentView": Models.BobCustomerAccountCurrentView;
      "BobCustomerAccountGetResponse": Models.BobCustomerAccountGetResponse;
      "BobReferenceQueryRequest": Models.BobReferenceQueryRequest;
      "ReferenceCandidate": Models.ReferenceCandidate;
      "ReferenceQueryResponse": Models.ReferenceQueryResponse;
      "AuxReferenceQueryRequest": Models.AuxReferenceQueryRequest;
      "AuxReferenceCandidate": Models.AuxReferenceCandidate;
      "AuxReferenceQueryResponse": Models.AuxReferenceQueryResponse;
      "BobReadableEntity": Models.BobReadableEntity;
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
      "VouAuxiliaryReferenceView": Models.VouAuxiliaryReferenceView;
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
      "SettlementTermCode": Models.SettlementTermCode;
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
      "VouVersionedReferenceInput": Models.VouVersionedReferenceInput;
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
      "DclWflProcessDefinitionCreateRequest": Models.DclWflProcessDefinitionCreateRequest;
      "DclWflProcessDefinitionMutation": Models.DclWflProcessDefinitionMutation;
      "DclWflProcessDefinitionMutationResponse": Models.DclWflProcessDefinitionMutationResponse;
      "DclWflProcessDefinitionVersionRequest": Models.DclWflProcessDefinitionVersionRequest;
      "DclWflProcessDefinitionSaveRequest": Models.DclWflProcessDefinitionSaveRequest;
      "WflDefinitionDiagnostic": Models.WflDefinitionDiagnostic;
      "WflDefinitionNode": Models.WflDefinitionNode;
      "WflDefinitionEdge": Models.WflDefinitionEdge;
      "DclWflProcessDefinitionView": Models.DclWflProcessDefinitionView;
      "DclWflProcessDefinitionViewResponse": Models.DclWflProcessDefinitionViewResponse;
      "DclWflProcessDefinitionReviewRequest": Models.DclWflProcessDefinitionReviewRequest;
      "DclWflProcessDefinitionDeleteRequest": Models.DclWflProcessDefinitionDeleteRequest;
      "DclWflProcessDefinitionEnableRequest": Models.DclWflProcessDefinitionEnableRequest;
      "DclWflProcessDefinitionQueryRequest": Models.DclWflProcessDefinitionQueryRequest;
      "DclWflProcessDefinitionVersionSummary": Models.DclWflProcessDefinitionVersionSummary;
      "DclWflProcessDefinitionListItem": Models.DclWflProcessDefinitionListItem;
      "DclWflProcessDefinitionQueryPageData": Models.DclWflProcessDefinitionQueryPageData;
      "DclWflProcessDefinitionQueryResponse": Models.DclWflProcessDefinitionQueryResponse;
      "DclWflProcessDefinitionGetRequest": Models.DclWflProcessDefinitionGetRequest;
      "DclWflProcessDefinitionHistoryRequest": Models.DclWflProcessDefinitionHistoryRequest;
      "DclWflProcessDefinitionVersionView": Models.DclWflProcessDefinitionVersionView;
      "DclWflProcessDefinitionVersionPageData": Models.DclWflProcessDefinitionVersionPageData;
      "DclWflProcessDefinitionVersionPageResponse": Models.DclWflProcessDefinitionVersionPageResponse;
      "WflDefinitionQueryRequest": Models.WflDefinitionQueryRequest;
      "WflDefinitionListItem": Models.WflDefinitionListItem;
      "WflDefinitionQueryResponse": Models.WflDefinitionQueryResponse;
      "WflDefinitionGetRequest": Models.WflDefinitionGetRequest;
      "WflDefinitionView": Models.WflDefinitionView;
      "WflDefinitionViewResponse": Models.WflDefinitionViewResponse;
      "WflDefinitionTrialRequest": Models.WflDefinitionTrialRequest;
      "WflBusinessObjectReference": Models.WflBusinessObjectReference;
      "WflExecutionTrace": Models.WflExecutionTrace;
      "WflPlannedAction": Models.WflPlannedAction;
      "WflDefinitionTrialResult": Models.WflDefinitionTrialResult;
      "WflDefinitionTrialResponse": Models.WflDefinitionTrialResponse;
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
