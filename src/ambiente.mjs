// Detecção de ambiente serverless, usada em mais de um lugar (geração de PDF,
// limite de upload, histórico de gerações) — centralizada aqui para as
// checagens não saírem de sincronia entre si.

/**
 * Verdadeiro quando o processo roda como função serverless (Vercel/AWS
 * Lambda), onde o sistema de arquivos é somente leitura fora de `/tmp` e o
 * processo não é de longa duração.
 */
export function emServerless() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}
