/**
 * The structure of llama-server's /props endpoint
 */
export interface PropsEndpoint {
  role: "router";
  max_instances: number;
  models_autoload: boolean;
  model_alias: string;
  model_path: string;
  default_generation_settings: Record<string, any>;
  ui_settings: Record<string, any>;
  build_info: string;
  cors_proxy_enabled: boolean;
}

/**
 * The structure of llama-server's /props?model=<id> endpoint
 */
export interface PropsModelEndpoint {
  error?: PropsError;
  default_generation_settings: {
    params: Record<string, any>;
    n_ctx: number;
  };
  total_slots: number;
  model_alias: string;
  model_path: string;
  modalities: {
    vision: boolean;
    video: boolean;
    audio: boolean;
  };
  media_marker: string;
  endpoint_slots: boolean;
  endpoint_props: boolean;
  endpoint_metrics: boolean;
  ui: boolean;
  ui_settings: Record<string, any>;
  chat_template: string;
  chat_template_caps: {
    supports_object_arguments: boolean;
    supports_parallel_tool_calls: boolean;
    supports_preserve_reasoning: boolean;
    supports_string_content: boolean;
    supports_system_role: boolean;
    supports_tool_calls: boolean;
    supports_tools: boolean;
    supports_typed_content: boolean;
  };
  bos_token: string;
  eos_token: string;
  build_info: string;
  is_sleeping: boolean;
  cors_proxy_enabled: boolean;
}

export interface PropsError {
  code: number;
  message: string;
  type: string;
}
