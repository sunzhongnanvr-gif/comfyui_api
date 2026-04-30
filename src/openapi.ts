type OpenApiSpec = Record<string, any>;

const baseComponents = {
  securitySchemes: {
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    },
  },
  schemas: {
    ApiResponse: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: { type: 'object' },
      },
    },
    AuthTokens: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        refreshToken: { type: 'string' },
      },
    },
    WorkflowListItem: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        slug: { type: 'string' },
        type: { type: 'string', example: 'image' },
        category: { type: 'string', nullable: true },
        description: { type: 'string', nullable: true },
        enabled: { type: 'boolean' },
        creditCost: { type: 'integer' },
        timeout: { type: 'integer', nullable: true },
        canSubmit: { type: 'boolean' },
      },
    },
    WorkflowInputParam: {
      type: 'object',
      properties: {
        key: { type: 'string', example: '27.text' },
        label: { type: 'string', example: '提示词' },
        inputType: { type: 'string', example: 'TEXT' },
        defaultValue: {},
        required: { type: 'boolean' },
        surface: { type: 'string', enum: ['user', 'setting', 'both', 'system'] },
        placeholder: { type: 'string', nullable: true },
        min: { type: 'number', nullable: true },
        max: { type: 'number', nullable: true },
        options: {
          type: 'array',
          items: {},
          nullable: true,
        },
      },
    },
    TaskSummary: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        type: { type: 'string', example: 'image' },
        status: { type: 'string', example: 'queued' },
        progress: { type: 'integer', example: 0 },
        queue_position: { type: 'integer', nullable: true },
        result_urls: {
          type: 'array',
          items: { type: 'string' },
        },
        error: { type: 'string', nullable: true },
        credit_cost: { type: 'integer', nullable: true },
        created_at: { type: 'string', format: 'date-time' },
        updated_at: { type: 'string', format: 'date-time' },
      },
    },
  },
};

const sharedPaths: Record<string, any> = {
  '/health': {
    get: {
      tags: ['Health'],
      summary: '健康检查',
      responses: {
        200: {
          description: '服务正常',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiResponse' },
            },
          },
        },
      },
    },
  },
  '/auth/register': {
    post: {
      tags: ['Auth'],
      summary: '注册',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['username', 'password', 'email', 'phone', 'realName'],
              properties: {
                username: { type: 'string' },
                password: { type: 'string' },
                email: { type: 'string' },
                phone: { type: 'string' },
                realName: { type: 'string' },
                avatar: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: '注册成功',
        },
      },
    },
  },
  '/auth/login': {
    post: {
      tags: ['Auth'],
      summary: '登录',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['username', 'password'],
              properties: {
                username: { type: 'string' },
                password: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: '登录成功',
        },
      },
    },
  },
  '/auth/refresh': {
    post: {
      tags: ['Auth'],
      summary: '刷新 token',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['refreshToken'],
              properties: {
                refreshToken: { type: 'string' },
              },
            },
          },
        },
      },
      responses: { 200: { description: '刷新成功' } },
    },
  },
  '/auth/me': {
    get: {
      tags: ['Auth'],
      summary: '当前用户信息',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: '当前用户' } },
    },
  },
  '/workflows': {
    get: {
      tags: ['Workflows'],
      summary: '工作流列表',
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: '当前用户可见工作流',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  data: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/WorkflowListItem' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  '/workflows/{slug}': {
    get: {
      tags: ['Workflows'],
      summary: '工作流详情',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'slug',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: { 200: { description: '工作流详情' } },
    },
  },
  '/workflows/{slug}/inputs': {
    get: {
      tags: ['Workflows'],
      summary: '工作流动态输入清单',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'slug',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: {
        200: {
          description: '输入参数清单',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  data: {
                    type: 'object',
                    properties: {
                      workflowId: { type: 'string' },
                      workflowSlug: { type: 'string' },
                      workflowName: { type: 'string' },
                      creditCost: { type: 'integer' },
                      timeout: { type: 'integer', nullable: true },
                      access: {
                        type: 'object',
                        properties: {
                          visible: { type: 'boolean' },
                          canSubmit: { type: 'boolean' },
                          reason: { type: 'string' },
                        },
                      },
                      fields: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/WorkflowInputParam' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  '/tasks/{workflowSlug}': {
    post: {
      tags: ['Tasks'],
      summary: '提交任务',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'workflowSlug',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
              schema: {
                type: 'object',
                additionalProperties: true,
                description: '动态表单按 fields 清单拼出来的平铺键值对',
              },
          },
        },
      },
      responses: {
        201: {
          description: '任务已创建',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  data: {
                    type: 'object',
                    properties: {
                      task_id: { type: 'string' },
                      status: { type: 'string' },
                      queue_position: { type: 'integer', nullable: true },
                      credit_cost: { type: 'integer' },
                      estimated_time: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  '/tasks/{taskId}': {
    get: {
      tags: ['Tasks'],
      summary: '查询任务状态',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'taskId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: {
        200: {
          description: '任务详情',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  data: { $ref: '#/components/schemas/TaskSummary' },
                },
              },
            },
          },
        },
      },
    },
    delete: {
      tags: ['Tasks'],
      summary: '删除任务',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'taskId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: { 200: { description: '任务已删除' } },
    },
  },
  '/tasks': {
    get: {
      tags: ['Tasks'],
      summary: '任务列表',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: '任务列表' } },
    },
  },
  '/upload/input': {
    post: {
      tags: ['Files'],
      summary: '上传输入文件',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file'],
              properties: {
                file: { type: 'string', format: 'binary' },
              },
            },
          },
        },
      },
      responses: { 200: { description: '上传成功' } },
    },
  },
  '/files/results/{userId}/{taskId}/{filename}': {
    get: {
      tags: ['Files'],
      summary: '任务结果文件',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'taskId', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'filename', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        200: { description: '文件内容' },
        404: { description: '文件不存在' },
      },
    },
  },
  '/user/credits': {
    get: {
      tags: ['User'],
      summary: '当前积分',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: '积分信息' } },
    },
  },
  '/user/credits/logs': {
    get: {
      tags: ['User'],
      summary: '积分流水',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: '积分流水' } },
    },
  },
  '/user/stats': {
    get: {
      tags: ['User'],
      summary: '用户统计',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: '统计信息' } },
    },
  },
  '/user/profile': {
    put: {
      tags: ['User'],
      summary: '更新个人资料',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: '更新成功' } },
    },
  },
};

const adminPaths: Record<string, any> = {
  '/admin/users': {
    get: {
      tags: ['Admin'],
      summary: '用户列表',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: '用户列表' } },
    },
  },
  '/admin/users/{id}': {
    put: {
      tags: ['Admin'],
      summary: '更新用户',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { 200: { description: '用户已更新' } },
    },
  },
  '/admin/users/{id}/credits': {
    post: {
      tags: ['Admin'],
      summary: '调整用户积分',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { 200: { description: '积分已调整' } },
    },
  },
  '/admin/users/{id}/credits/logs': {
    get: {
      tags: ['Admin'],
      summary: '用户积分流水',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { 200: { description: '积分流水' } },
    },
  },
  '/admin/workflows': {
    get: {
      tags: ['Admin'],
      summary: '工作流列表',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: '工作流列表' } },
    },
  },
  '/admin/workflows/{id}': {
    put: {
      tags: ['Admin'],
      summary: '更新工作流基础信息',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { 200: { description: '工作流已更新' } },
    },
    delete: {
      tags: ['Admin'],
      summary: '删除工作流',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { 200: { description: '工作流已删除' } },
    },
  },
  '/admin/workflows/{id}/params': {
    get: {
      tags: ['Admin'],
      summary: '查看工作流参数',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { 200: { description: '参数清单' } },
    },
    put: {
      tags: ['Admin'],
      summary: '保存工作流参数',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { 200: { description: '参数已保存' } },
    },
  },
  '/admin/workflows/{id}/inputs': {
    get: {
      tags: ['Admin'],
      summary: '工作流测试输入',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { 200: { description: '测试输入' } },
    },
  },
  '/admin/workflows/{id}/access': {
    get: {
      tags: ['Admin'],
      summary: '查看工作流授权',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { 200: { description: '授权配置' } },
    },
    put: {
      tags: ['Admin'],
      summary: '保存工作流授权',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { 200: { description: '授权已保存' } },
    },
  },
  '/admin/workflows/{id}/convert-to-api': {
    post: {
      tags: ['Admin'],
      summary: '转换工作流为 API 模板',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { 200: { description: '转换完成' } },
    },
  },
  '/admin/workflows/{id}/download-missing-models': {
    post: {
      tags: ['Admin'],
      summary: '下载工作流缺失模型',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { 200: { description: '下载已提交' } },
    },
  },
  '/admin/tasks': {
    get: {
      tags: ['Admin'],
      summary: '任务管理',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: '任务列表' } },
    },
  },
  '/admin/tasks/{id}': {
    get: {
      tags: ['Admin'],
      summary: '任务详情',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { 200: { description: '任务详情' } },
    },
    delete: {
      tags: ['Admin'],
      summary: '删除任务',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { 200: { description: '任务已删除' } },
    },
  },
  '/admin/models': {
    get: {
      tags: ['Admin'],
      summary: '模型管理',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: '模型列表' } },
    },
  },
  '/admin/models/download': {
    post: {
      tags: ['Admin'],
      summary: '下载模型',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: '下载已提交' } },
    },
  },
  '/admin/download-tasks': {
    get: {
      tags: ['Admin'],
      summary: '下载任务列表',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: '下载任务列表' } },
    },
  },
  '/admin/stats/overview': {
    get: {
      tags: ['Admin'],
      summary: '概览统计',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: '概览统计' } },
    },
  },
  '/admin/config': {
    get: {
      tags: ['Admin'],
      summary: '系统配置',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: '系统配置' } },
    },
    put: {
      tags: ['Admin'],
      summary: '保存系统配置',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: '配置已保存' } },
    },
  },
  '/admin/user-levels': {
    get: {
      tags: ['Admin'],
      summary: '用户等级',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: '用户等级列表' } },
    },
  },
  '/admin/storage-volumes': {
    get: {
      tags: ['Admin'],
      summary: '存储卷',
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: '存储卷列表' } },
    },
  },
  '/admin/nodes/{id}/container/{action}': {
    post: {
      tags: ['Admin'],
      summary: '容器操作',
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'action', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { 200: { description: '操作完成' } },
    },
  },
};

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function buildSpec(title: string, description: string, paths: Record<string, any>): OpenApiSpec {
  return {
    openapi: '3.0.3',
    info: {
      title,
      version: '1.0.0',
      description,
    },
    servers: [
      { url: '/api/v1', description: '当前服务' },
    ],
    tags: [
      { name: 'Health', description: '健康检查' },
      { name: 'Auth', description: '认证' },
      { name: 'Workflows', description: '工作流' },
      { name: 'Tasks', description: '任务' },
      { name: 'Files', description: '文件' },
      { name: 'User', description: '用户' },
      { name: 'Admin', description: '管理端' },
    ],
    components: deepClone(baseComponents),
    paths: deepClone(paths),
  };
}

export const internalOpenApiSpec = buildSpec(
  'ComfyUI Middleware Internal API',
  'ComfyUI 中转站守护进程完整接口文档。包含客户端、管理端和内部调试路由。',
  {
    ...sharedPaths,
    ...adminPaths,
  }
);

export const androidOpenApiSpec = buildSpec(
  'ComfyUI Android Client API',
  'Android 客户端接口文档。只保留用户端可以直接调用的认证、工作流、任务和资源接口。',
  sharedPaths
);

export const webOpenApiSpec = buildSpec(
  'ComfyUI Web Client API',
  'Web 用户端接口文档。只保留用户端可以直接调用的认证、工作流、任务和资源接口。',
  sharedPaths
);
