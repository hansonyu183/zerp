<template>
  <v-empty-state
    headline="404"
    title="页面不存在"
    text="请从导航菜单进入已有业务页面。"
    icon="mdi-map-marker-question-outline"
    ><template #actions
      ><v-btn color="primary" to="/home/dashboard">返回工作台</v-btn></template
    ></v-empty-state
  >
</template>
