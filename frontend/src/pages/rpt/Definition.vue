<script setup lang="ts">
import { useReportViewModel } from './vm'

const {
  definitionOptions,
  errorMessage,
  loadDefinitions,
  loading,
  managementCode,
  managementData,
  managementPermissions,
  managementRevision,
  managementVersionId,
  manage,
  notice,
  selectManagementDefinition,
} = useReportViewModel('definition')
</script>

<template>
  <v-container class="pa-4" fluid>
    <div class="d-flex align-center mb-4 ga-3">
      <h1 class="text-h5">报表定义管理</h1>
      <v-spacer />
      <v-btn variant="text" :loading="loading" @click="loadDefinitions"
        >刷新</v-btn
      >
    </div>
    <v-alert
      v-if="errorMessage"
      type="error"
      class="mb-3"
      closable
      @click:close="errorMessage = ''"
      >{{ errorMessage }}</v-alert
    >
    <v-alert
      v-if="notice"
      type="success"
      class="mb-3"
      closable
      @click:close="notice = ''"
      >{{ notice }}</v-alert
    >
    <v-card max-width="900"
      ><v-card-text>
        <v-select
          v-model="managementCode"
          label="已有报表"
          :items="definitionOptions"
          @update:model-value="selectManagementDefinition"
        />
        <v-text-field v-model="managementCode" label="报表编码" />
        <v-text-field v-model="managementVersionId" label="版本 ID" />
        <v-text-field
          v-model.number="managementRevision"
          label="修订号"
          type="number"
        />
        <v-textarea v-model="managementData" label="版本数据 JSON" auto-grow />
        <div class="d-flex flex-wrap ga-2">
          <v-btn
            v-if="managementPermissions.create"
            size="small"
            @click="manage('create')"
            >新建定义</v-btn
          ><v-btn
            v-if="managementPermissions['create-version']"
            size="small"
            @click="manage('create-version')"
            >新建版本</v-btn
          ><v-btn
            v-if="managementPermissions.save"
            size="small"
            @click="manage('save')"
            >保存版本</v-btn
          ><v-btn
            v-if="managementPermissions.approve"
            size="small"
            @click="manage('approve')"
            >批准</v-btn
          ><v-btn
            v-if="managementPermissions.unapprove"
            size="small"
            @click="manage('unapprove')"
            >反批准</v-btn
          ><v-btn
            v-if="managementPermissions.enable"
            size="small"
            @click="manage('enable')"
            >启用</v-btn
          ><v-btn
            v-if="managementPermissions.disable"
            size="small"
            @click="manage('disable')"
            >停用</v-btn
          ><v-btn
            v-if="managementPermissions.delete"
            size="small"
            color="error"
            @click="manage('delete')"
            >删除</v-btn
          >
        </div>
      </v-card-text></v-card
    >
  </v-container>
</template>
