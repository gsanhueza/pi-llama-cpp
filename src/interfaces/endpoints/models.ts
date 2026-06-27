/**
 * The structure of llama-server's /models endpoint
 *
 * In single mode, the `models` property is not returned
 * In router mode, everything is used
 */
export interface ModelsEndpoint {
  models?: ModelProperty[];
  object: string;
  data: DataProperty[];
}

export interface ModelProperty {
  name: string;
  model: string;
  modified_at: string;
  size: string;
  digest: string;
  type: string;
  description: string;
  tags: string[];
  capabilities: string[];
  parameters: string;
  details: {
    parent_model: string;
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

export interface DataProperty {
  id: string;
  aliases?: string[];
  tags: string[];
  object: string;
  owned_by: string;
  created: number;
  status?: StatusProperty;
  architecture?: ArchitectureProperty;
  source?: string;
  can_remove?: boolean;
  need_download?: boolean;
  meta?: MetaProperty;
}

interface StatusProperty {
  value: string;
  args: string[];
  preset: string;
  exit_code?: number;
  failed?: boolean;
}

interface ArchitectureProperty {
  input_modalities: ("text" | "image" | "audio")[];
  output_modalities: ["text"];
}

interface MetaProperty {
  vocab_type: number;
  n_vocab: number;
  n_ctx: number;
  n_ctx_train: number;
  n_embd: number;
  n_params: number;
  size: number;
}
