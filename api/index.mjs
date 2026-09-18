// Ponto de entrada em hospedagem serverless (Vercel e afins).
//
// A plataforma importa este arquivo e chama o handler exportado a cada
// requisição — não existe processo de longa duração, então nada de listen()
// aqui. O app é o mesmo do servidor local, sem nenhuma rota diferente.
//
// Os arquivos estáticos de public/ são servidos pela própria plataforma, antes
// de a requisição chegar até aqui.

export { default } from "../src/app.mjs";
