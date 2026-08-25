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
      requestBody: { content: { 'application/json': Models.OpeningActionRequest } };
      responses: { 200: { content: { 'application/json': Models.OpeningEnvelope } } };
    };
  };
  "/acc/opening/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.OpeningActionRequest } };
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
      requestBody: { content: { 'application/json': Models.MappingActionRequest } };
      responses: { 200: { content: { 'application/json': Models.MappingEnvelope } } };
    };
  };
  "/acc/mapping/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.MappingActionRequest } };
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
  "/bob/party/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.PartySaveRequest } };
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
  "/bob/other-unit/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.OtherUnitCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.OtherUnitMutationResponse } } };
    };
  };
  "/bob/other-unit/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.OtherUnitSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.OtherUnitMutationResponse } } };
    };
  };
  "/bob/other-unit/delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobDeleteRequest } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
    };
  };
  "/bob/other-unit/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobVersionRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.OtherUnitMutationResponse } } };
    };
  };
  "/bob/other-unit/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobVersionRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.OtherUnitMutationResponse } } };
    };
  };
  "/bob/other-unit/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobVersionRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.OtherUnitMutationResponse } } };
    };
  };
  "/bob/other-unit/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.OtherUnitMutationResponse } } };
    };
  };
  "/bob/other-unit/enable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobObjectRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.OtherUnitMutationResponse } } };
    };
  };
  "/bob/other-unit/disable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobObjectRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.OtherUnitMutationResponse } } };
    };
  };
  "/bob/other-unit/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.BobVersionHistoryResponse } } };
    };
  };
  "/bob/other-unit/audit-history": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.BobAuditHistoryResponse } } };
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
  "/bob/supplier/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.SupplierCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.SupplierCreateResponse } } };
    };
  };
  "/bob/supplier/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.SupplierSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.BobMutationResponse } } };
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
  "/bob/sales-partner/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.SalesPartnerCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.SalesPartnerMutationResponse } } };
    };
  };
  "/bob/sales-partner/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.SalesPartnerSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.SalesPartnerMutationResponse } } };
    };
  };
  "/bob/party/merge-preflight": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.PartyMergePreflightRequest } };
      responses: { 200: { content: { 'application/json': Models.PartyMergePreflightResponse } } };
    };
  };
  "/bob/party/merge-confirm": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.PartyMergeConfirmRequest } };
      responses: { 200: { content: { 'application/json': Models.PartyMergeConfirmResponse } } };
    };
  };
  "/bob/employee/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.EmploymentCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.BobMutationResponse } } };
    };
  };
  "/bob/{entity}/query": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobCrudEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobQueryRequest } };
      responses: { 200: { content: { 'application/json': Models.BobQueryResponse } } };
    };
  };
  "/bob/{entity}/get": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobCrudEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobGetRequest } };
      responses: { 200: { content: { 'application/json': Models.BobObjectResponse } } };
    };
  };
  "/bob/{entity}/create": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobCrudEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.BobMutationResponse } } };
    };
  };
  "/bob/{entity}/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobCrudEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.BobMutationResponse } } };
    };
  };
  "/bob/{entity}/delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobDeleteRequest } };
      responses: { 200: { content: { 'application/json': Models.EmptyResponse } } };
    };
  };
  "/bob/{entity}/submit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobVersionRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.BobMutationResponse } } };
    };
  };
  "/bob/{entity}/unsubmit": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobVersionRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.BobMutationResponse } } };
    };
  };
  "/bob/{entity}/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobVersionRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.BobMutationResponse } } };
    };
  };
  "/bob/{entity}/reject": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.BobMutationResponse } } };
    };
  };
  "/bob/{entity}/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobReviewRequest } };
      responses: { 200: { content: { 'application/json': Models.BobUnapproveResponse } } };
    };
  };
  "/bob/{entity}/enable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobObjectRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.BobMutationResponse } } };
    };
  };
  "/bob/{entity}/disable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobObjectRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.BobDisableResponse } } };
    };
  };
  "/bob/{entity}/versions": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.BobHistoryRequest } };
      responses: { 200: { content: { 'application/json': Models.BobVersionHistoryResponse } } };
    };
  };
  "/bob/{entity}/audit-history": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.BobEntity; }; cookie?: never };
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
  "/vou/{entity}/check": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path: { "entity": Models.VouEntity; }; cookie?: never };
      requestBody: { content: { 'application/json': Models.VouDocumentRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.VouMutationResponse } } };
    };
  };
  "/vou/{entity}/uncheck": {
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
  "/wfl/process-definition/publish": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflDefinitionActionRequest } };
      responses: { 200: { content: { 'application/json': Models.WflDefinitionViewResponse } } };
    };
  };
  "/wfl/process-definition/enable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflDefinitionActionRequest } };
      responses: { 200: { content: { 'application/json': Models.WflDefinitionViewResponse } } };
    };
  };
  "/wfl/process-definition/disable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflDefinitionActionRequest } };
      responses: { 200: { content: { 'application/json': Models.WflDefinitionViewResponse } } };
    };
  };
  "/wfl/process-definition/delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.WflDefinitionActionRequest } };
      responses: { 200: { content: { 'application/json': Models.WflDefinitionDeleteResponse } } };
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
      responses: { 200: { content: { 'application/json': Models.RptMutationResponse } } };
    };
  };
  "/rpt/definition/create-version": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptVersionCreateRequest } };
      responses: { 200: { content: { 'application/json': Models.RptMutationResponse } } };
    };
  };
  "/rpt/definition/save": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptVersionSaveRequest } };
      responses: { 200: { content: { 'application/json': Models.RptMutationResponse } } };
    };
  };
  "/rpt/definition/approve": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptVersionRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.RptMutationResponse } } };
    };
  };
  "/rpt/definition/unapprove": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptVersionRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.RptMutationResponse } } };
    };
  };
  "/rpt/definition/enable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptDefinitionRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.RptMutationResponse } } };
    };
  };
  "/rpt/definition/disable": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptDefinitionRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.RptMutationResponse } } };
    };
  };
  "/rpt/definition/delete": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody: { content: { 'application/json': Models.RptDefinitionRevisionRequest } };
      responses: { 200: { content: { 'application/json': Models.RptMutationResponse } } };
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
      "OpeningState": Models.OpeningState;
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
      "OpeningActionRequest": Models.OpeningActionRequest;
      "MappingQueryRequest": Models.MappingQueryRequest;
      "MappingState": Models.MappingState;
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
      "MappingSaveRequest": Models.MappingSaveRequest;
      "MappingActionRequest": Models.MappingActionRequest;
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
      "WorkbenchCategory": Models.WorkbenchCategory;
      "WorkbenchPendingStage": Models.WorkbenchPendingStage;
      "WorkbenchQueryRequest": Models.WorkbenchQueryRequest;
      "BobEntity": Models.BobEntity;
      "WorkbenchAction": Models.WorkbenchAction;
      "WorkbenchObjectItem": Models.WorkbenchObjectItem;
      "VouEntity": Models.VouEntity;
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
      "ApprovalEventView": Models.ApprovalEventView;
      "AuxAuditEventPage": Models.AuxAuditEventPage;
      "AuxAuditEventPageResponse": Models.AuxAuditEventPageResponse;
      "PartyKind": Models.PartyKind;
      "PartyQueryRequest": Models.PartyQueryRequest;
      "PartyListItem": Models.PartyListItem;
      "PartyQueryResponse": Models.PartyQueryResponse;
      "PartyGetRequest": Models.PartyGetRequest;
      "PartyIdentifierType": Models.PartyIdentifierType;
      "PartyIdentifier": Models.PartyIdentifier;
      "PartyRelationshipCard": Models.PartyRelationshipCard;
      "PartyView": Models.PartyView;
      "PartyGetResponse": Models.PartyGetResponse;
      "PartySaveRequest": Models.PartySaveRequest;
      "OtherUnitQueryRequest": Models.OtherUnitQueryRequest;
      "OtherUnitData": Models.OtherUnitData;
      "OtherUnitView": Models.OtherUnitView;
      "OtherUnitPage": Models.OtherUnitPage;
      "OtherUnitQueryResponse": Models.OtherUnitQueryResponse;
      "BobGetRequest": Models.BobGetRequest;
      "OtherUnitGetResponse": Models.OtherUnitGetResponse;
      "OtherUnitCreateWithExistingPartyRequest": Models.OtherUnitCreateWithExistingPartyRequest;
      "PartyIdentityData": Models.PartyIdentityData;
      "OtherUnitCreateWithNewPartyRequest": Models.OtherUnitCreateWithNewPartyRequest;
      "OtherUnitCreateRequest": Models.OtherUnitCreateRequest;
      "OtherUnitMutationResult": Models.OtherUnitMutationResult;
      "OtherUnitMutationResponse": Models.OtherUnitMutationResponse;
      "OtherUnitSaveRequest": Models.OtherUnitSaveRequest;
      "BobDeleteRequest": Models.BobDeleteRequest;
      "BobVersionRevisionRequest": Models.BobVersionRevisionRequest;
      "BobReviewRequest": Models.BobReviewRequest;
      "BobObjectRevisionRequest": Models.BobObjectRevisionRequest;
      "BobHistoryRequest": Models.BobHistoryRequest;
      "BobVersionHistoryItem": Models.BobVersionHistoryItem;
      "BobVersionHistoryPage": Models.BobVersionHistoryPage;
      "BobVersionHistoryResponse": Models.BobVersionHistoryResponse;
      "BobAuditEventPage": Models.BobAuditEventPage;
      "BobAuditHistoryResponse": Models.BobAuditHistoryResponse;
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
      "SupplierQueryRequest": Models.SupplierQueryRequest;
      "SupplierListVersion": Models.SupplierListVersion;
      "SupplierListItem": Models.SupplierListItem;
      "SupplierQueryResponse": Models.SupplierQueryResponse;
      "SupplierSettlementSnapshot": Models.SupplierSettlementSnapshot;
      "SupplierView": Models.SupplierView;
      "SupplierVersionView": Models.SupplierVersionView;
      "SupplierDetailView": Models.SupplierDetailView;
      "SupplierGetResponse": Models.SupplierGetResponse;
      "SupplierInput": Models.SupplierInput;
      "SupplierCreateRequest": Models.SupplierCreateRequest;
      "SupplierCreateResult": Models.SupplierCreateResult;
      "SupplierCreateResponse": Models.SupplierCreateResponse;
      "SupplierSaveRequest": Models.SupplierSaveRequest;
      "BobReferenceQueryRequest": Models.BobReferenceQueryRequest;
      "BobMeasurementUnitSnapshot": Models.BobMeasurementUnitSnapshot;
      "BobProductUnitConversionSnapshot": Models.BobProductUnitConversionSnapshot;
      "ReferenceCandidate": Models.ReferenceCandidate;
      "ReferenceQueryResponse": Models.ReferenceQueryResponse;
      "AuxReferenceQueryRequest": Models.AuxReferenceQueryRequest;
      "SalesPartnerCapability": Models.SalesPartnerCapability;
      "SalesPartnerQueryRequest": Models.SalesPartnerQueryRequest;
      "SalesPartnerListVersion": Models.SalesPartnerListVersion;
      "SalesPartnerListItem": Models.SalesPartnerListItem;
      "SalesPartnerPage": Models.SalesPartnerPage;
      "SalesPartnerQueryResponse": Models.SalesPartnerQueryResponse;
      "SalesPartnerDataView": Models.SalesPartnerDataView;
      "SalesPartnerVersionView": Models.SalesPartnerVersionView;
      "SalesPartnerDetailView": Models.SalesPartnerDetailView;
      "SalesPartnerGetResponse": Models.SalesPartnerGetResponse;
      "SalesPartnerInput": Models.SalesPartnerInput;
      "SalesPartnerCreateRequest": Models.SalesPartnerCreateRequest;
      "SalesPartnerMutationResult": Models.SalesPartnerMutationResult;
      "SalesPartnerMutationResponse": Models.SalesPartnerMutationResponse;
      "SalesPartnerSaveRequest": Models.SalesPartnerSaveRequest;
      "PartyMergePreflightRequest": Models.PartyMergePreflightRequest;
      "PartyMergeRelationshipConflict": Models.PartyMergeRelationshipConflict;
      "PartyMergePreflightResult": Models.PartyMergePreflightResult;
      "PartyMergePreflightResponse": Models.PartyMergePreflightResponse;
      "PartyMergeConflictResolution": Models.PartyMergeConflictResolution;
      "PartyMergeConfirmRequest": Models.PartyMergeConfirmRequest;
      "PartyMergeResult": Models.PartyMergeResult;
      "PartyMergeConfirmResponse": Models.PartyMergeConfirmResponse;
      "EmploymentData": Models.EmploymentData;
      "EmploymentCreateRequest": Models.EmploymentCreateRequest;
      "BobCrudEntity": Models.BobCrudEntity;
      "BobQueryRequest": Models.BobQueryRequest;
      "BobVersionSummary": Models.BobVersionSummary;
      "BobListItem": Models.BobListItem;
      "BobListPage": Models.BobListPage;
      "BobQueryResponse": Models.BobQueryResponse;
      "VehicleInternalCarrierAffiliation": Models.VehicleInternalCarrierAffiliation;
      "VehicleExternalCarrierAffiliation": Models.VehicleExternalCarrierAffiliation;
      "VehicleCarrierAffiliation": Models.VehicleCarrierAffiliation;
      "BobMeasurementUnitSnapshotInput": Models.BobMeasurementUnitSnapshotInput;
      "BobProductUnitConversionInput": Models.BobProductUnitConversionInput;
      "BobQuantitySnapshotInput": Models.BobQuantitySnapshotInput;
      "BobProductFormulaComponentInput": Models.BobProductFormulaComponentInput;
      "BobProductFormulaInput": Models.BobProductFormulaInput;
      "data": Models.data;
      "BobDetailView": Models.BobDetailView;
      "BobRelationshipIdentityView": Models.BobRelationshipIdentityView;
      "BobObjectView": Models.BobObjectView;
      "BobObjectResponse": Models.BobObjectResponse;
      "BobCreateRequest": Models.BobCreateRequest;
      "BobSaveRequest": Models.BobSaveRequest;
      "BobActiveReferenceCount": Models.BobActiveReferenceCount;
      "BobActiveReferenceBlockers": Models.BobActiveReferenceBlockers;
      "BobUnapproveResponse": Models.BobUnapproveResponse;
      "WarehouseInventoryConflict": Models.WarehouseInventoryConflict;
      "VouStatus": Models.VouStatus;
      "WarehouseDocumentConflict": Models.WarehouseDocumentConflict;
      "WarehouseDisableBlockers": Models.WarehouseDisableBlockers;
      "BobDisableResponse": Models.BobDisableResponse;
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
      "VouAuditEventView": Models.VouAuditEventView;
      "VouAuditHistoryResponse": Models.VouAuditHistoryResponse;
      "VouAttachmentInitiateRequest": Models.VouAttachmentInitiateRequest;
      "VouAttachmentInitiateResult": Models.VouAttachmentInitiateResult;
      "VouAttachmentInitiateResponse": Models.VouAttachmentInitiateResponse;
      "VouAttachmentDownloadRequest": Models.VouAttachmentDownloadRequest;
      "VouAttachmentDownloadResult": Models.VouAttachmentDownloadResult;
      "VouAttachmentDownloadResponse": Models.VouAttachmentDownloadResponse;
      "VouAttachmentRemoveRequest": Models.VouAttachmentRemoveRequest;
      "WflDefinitionStatus": Models.WflDefinitionStatus;
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
      "WflDefinitionActionRequest": Models.WflDefinitionActionRequest;
      "WflDefinitionDeleteResult": Models.WflDefinitionDeleteResult;
      "WflDefinitionDeleteResponse": Models.WflDefinitionDeleteResponse;
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
      "RptMutationResult": Models.RptMutationResult;
      "RptMutationResponse": Models.RptMutationResponse;
      "RptVersionCreateRequest": Models.RptVersionCreateRequest;
      "RptVersionSaveRequest": Models.RptVersionSaveRequest;
      "RptVersionRevisionRequest": Models.RptVersionRevisionRequest;
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
