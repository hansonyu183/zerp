<script setup lang="ts">
type UserActionKind = 'enable' | 'disable' | 'reset' | null

defineProps<{
  open: boolean
  kind: UserActionKind
  username: string
  loading: boolean
}>()

const emit = defineEmits<{
  cancel: []
  confirm: []
}>()
</script>

<template>
  <v-dialog :model-value="open" max-width="480" persistent>
    <v-card>
      <v-card-title>
        {{
          kind === 'reset'
            ? '重置密码'
            : kind === 'disable'
              ? '停用用户'
              : '启用用户'
        }}
      </v-card-title>
      <v-card-text v-if="kind === 'disable'">
        确定停用 {{ username }}？该用户的全部现有会话将立即失效。
      </v-card-text>
      <v-card-text v-else-if="kind === 'enable'">
        确定启用 {{ username }}？密码保持不变，旧会话不会恢复。
      </v-card-text>
      <v-card-text v-else>
        确定重置
        {{ username }}
        的密码？旧密码立即失效，全部会话将被撤销，用户下次登录必须修改临时密码。
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn :disabled="loading" @click="emit('cancel')">取消</v-btn>
        <v-btn color="primary" :loading="loading" @click="emit('confirm')">
          确认
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
