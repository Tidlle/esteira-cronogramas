// Sobe a esteira num servidor local.
//
//   npm start
//
// Por padrão escuta só em 127.0.0.1, ou seja, fica acessível apenas na máquina
// que o executa. Para liberar na rede local, defina HOST=0.0.0.0 — mas repare
// que não há autenticação nenhuma: quem alcançar a porta usa o sistema.
//
// Em hospedagem serverless quem entrega o app é api/index.mjs; este arquivo não
// roda lá.

import { app } from "./src/app.mjs";
import { fecharNavegador } from "./src/generate-pdf.mjs";

const PORTA = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";

const servidor = app.listen(PORTA, HOST, () => {
  console.log(`Esteira de cronogramas em http://${HOST}:${PORTA}`);
  if (HOST === "0.0.0.0") {
    console.log(
      "Atenção: escutando em todas as interfaces, e o sistema não tem login.",
    );
  }
});

for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, async () => {
    servidor.close();
    await fecharNavegador();
    process.exit(0);
  });
}
