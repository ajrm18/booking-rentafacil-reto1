import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Ruta de src/proto/inventory.proto tanto en desarrollo/pruebas (src/) como compilado (dist/proto,
 * copiado por nest-cli "assets").
 */
export function inventoryProtoPath(): string {
  const candidatos = [
    join(__dirname, '..', '..', '..', 'proto', 'inventory.proto'),
    join(process.cwd(), 'dist', 'proto', 'inventory.proto'),
    join(process.cwd(), 'src', 'proto', 'inventory.proto'),
  ];
  const ruta = candidatos.find((c) => existsSync(c));
  if (!ruta) throw new Error(`No se encontro inventory.proto (buscado en ${candidatos.join(', ')})`);
  return ruta;
}

/** Opciones de @grpc/proto-loader: nombres de campo tal cual el .proto (service_id, no serviceId). */
export const PROTO_LOADER_OPTIONS = {
  keepCase: true, longs: Number, enums: String, defaults: true, oneofs: true,
};

export const GRPC_PACKAGE = 'inventory';
