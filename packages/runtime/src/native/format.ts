import { RUNTIME_MAX_BYTES, runtimeFail, type RuntimeProgram } from './model';
import { validateRuntimeProgram } from './validate';

function boundedUTF8(text: string): Uint8Array {
  if (text.length > RUNTIME_MAX_BYTES)
    runtimeFail(
      'RESOURCE_LIMIT',
      'Runtime file exceeds 128 MiB.',
      null,
      'Split the export or reduce image sizes.',
    );
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > RUNTIME_MAX_BYTES)
    runtimeFail(
      'RESOURCE_LIMIT',
      'UTF-8 runtime file exceeds 128 MiB.',
      null,
      'Split the export or reduce image sizes.',
    );
  return bytes;
}

/** Human-readable debug JSON and compact .bbb have identical semantics and native headers. */
export function serializeRuntime(program: RuntimeProgram, options: { pretty?: boolean } = {}): string {
  const validated = validateRuntimeProgram(program);
  const json = JSON.stringify(validated, null, options.pretty ? 2 : undefined);
  boundedUTF8(json);
  return json;
}
export function encodeRuntime(program: RuntimeProgram): Uint8Array {
  return boundedUTF8(serializeRuntime(program));
}

/** Strict v1 loading; there is no renamed-authoring-file or legacy-reader fallback. */
export function loadRuntime(input: string | Uint8Array): RuntimeProgram {
  let text: string;
  if (typeof input === 'string') {
    boundedUTF8(input);
    text = input;
  } else {
    if (!(input instanceof Uint8Array))
      runtimeFail('INVALID_BYTES', 'Runtime input must be UTF-8 bytes or JSON text.');
    if (input.byteLength > RUNTIME_MAX_BYTES)
      runtimeFail(
        'RESOURCE_LIMIT',
        'Runtime file exceeds 128 MiB.',
        null,
        'Split the export or reduce image sizes.',
      );
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(input);
    } catch {
      return runtimeFail(
        'INVALID_UTF8',
        'Runtime bytes are not valid UTF-8.',
        null,
        'Export the runtime file again.',
      );
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return runtimeFail(
      'INVALID_JSON',
      'Runtime file is not valid JSON.',
      null,
      'Export the complete runtime file again.',
    );
  }
  return validateRuntimeProgram(parsed);
}
