export interface DocumentTypeRecord {
  id?: number | string;
  document_type?: number | string;
  is_accounting?: boolean;
}

export interface DocumentTypeEnvelope {
  data?: DocumentTypeRecord[] | {
    document_type_list?: DocumentTypeRecord[];
    document_types?: DocumentTypeRecord[];
  };
}

export function documentTypesFromEnvelope(
  envelope: DocumentTypeEnvelope,
): DocumentTypeRecord[] {
  if (Array.isArray(envelope.data)) return envelope.data;
  return envelope.data?.document_type_list ?? envelope.data?.document_types ?? [];
}
