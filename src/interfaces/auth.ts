interface Auth {
  type: string;
  key: string;
}

export type AuthFile = Record<string, Auth>;
