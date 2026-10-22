# PRD: Worktrees em paralelo

## Visão geral

Hoje o Hotswap garante uma worktree rodando por projeto: abrir outra worktree do mesmo projeto encerra a anterior. Isso é o certo quando o desenvolvedor só alterna de contexto, mas atrapalha quando ele desenvolve duas features do mesmo projeto ao mesmo tempo. Ele precisa das duas de pé, cada uma com sua API e seu front, e hoje a única saída é abrir um terminal fora do app, trocar a porta à mão e apontar o front para a API certa à mão.

A feature cria um **modo paralelo**, ligado ou desligado por projeto. Com ele ligado, várias worktrees do mesmo projeto rodam juntas. O app evita que elas disputem a mesma porta e liga o front de cada worktree à API dela. Com ele desligado, o projeto se comporta exatamente como hoje.

O usuário é o mesmo de sempre: um único desenvolvedor, na própria máquina Linux, com API e front em repositórios separados.

## Objetivos

- **Objetivo principal:** desenvolver duas features do mesmo projeto ao mesmo tempo, dentro do app, sem que nenhuma worktree caia por porta ocupada.
- **Métrica:** nenhum `EADDRINUSE` causado por outra worktree do mesmo projeto. A segunda worktree nunca cai porque a primeira já ocupa a porta.
- **A acompanhar:** com o modo desligado, nada muda em relação ao comportamento atual (troca, parada, palhetas, atalhos).

## Histórias de usuário

- Como desenvolvedor, eu quero ligar o modo paralelo no LEILAO para deixar `feat/a` rodando enquanto subo `feat/b`.
- Como desenvolvedor, eu quero que o app me proponha portas livres para a segunda worktree, para não precisar descobrir quais estão ocupadas.
- Como desenvolvedor, eu quero editar as portas propostas antes de subir, para manter uma convenção minha (3334, 3001…).
- Como desenvolvedor, eu quero que o front de `feat/b` fale com a API de `feat/b` e nunca com a de `feat/a`, para testar cada feature isolada.
- Como desenvolvedor, eu quero ver no painel quais worktrees estão de pé e em que portas, para saber de relance o que está rodando.
- Como desenvolvedor, eu quero desligar o modo e ficar só com a worktree que estou vendo, sem parar uma por uma.
- **Borda:** como desenvolvedor, eu quero ser avisado antes de subir se uma porta escolhida já está ocupada, em vez de ver o servidor cair.
- **Borda:** como desenvolvedor, eu quero que o INTERNO continue no modo de sempre enquanto o LEILAO está em paralelo.

## Funcionalidades principais

### 1. Interruptor do modo paralelo por projeto

O que faz: liga ou desliga, para cada projeto, a regra de uma worktree rodando por projeto.
Por que importa: a troca destrutiva continua sendo o padrão certo para quem só alterna. O paralelo é uma escolha consciente, por projeto.

- **RF1.1** Cada projeto tem o próprio interruptor. Ligar em um não afeta os outros.
- **RF1.2** O padrão é desligado. Projetos existentes continuam se comportando como hoje.
- **RF1.3** A escolha sobrevive ao fechar e reabrir o app.
- **RF1.4** Dá para ligar e desligar pelo teclado e pelo mouse.
- **RF1.5** O painel mostra de relance quais projetos estão em modo paralelo.

### 2. Subir worktrees juntas

O que faz: com o modo ligado, abrir uma worktree do projeto não encerra as que já estão rodando.
Por que importa: é o objetivo da feature, que é ter duas features de pé ao mesmo tempo.

- **RF2.1** Com o modo ligado, selecionar uma worktree parada do projeto (no painel, na paleta ou por atalho) mostra essa worktree e sobe os servidores dela. As outras worktrees do projeto continuam rodando.
- **RF2.2** Selecionar uma worktree que já está rodando só a mostra, sem reiniciar nada.
- **RF2.3** Não há limite de worktrees rodando juntas.
- **RF2.4** Nada no modo paralelo anuncia que algo será encerrado: a prévia ENCERRA no painel e o "Enter encerra X" na paleta não aparecem para as worktrees desse projeto, e a faixa da troca não aparece ao trocar de tela.
- **RF2.5** Parar, Subir e Reiniciar continuam valendo para a worktree que está na tela, com os mesmos atalhos. As outras seguem rodando.
- **RF2.6** Uma worktree em segundo plano que cai gera o mesmo aviso de falha de hoje (segunda faixa e, com a janela escondida ou sem foco, a notificação do sistema), dizendo qual worktree caiu.

### 3. Portas sem colisão

O que faz: quando uma worktree vai subir com outra do mesmo projeto já rodando, o app propõe portas livres para os lados dela, e o usuário confirma ou edita antes de subir.
Por que importa: é o que impede o `EADDRINUSE`, a métrica de sucesso.

- **RF3.1** A primeira worktree de pé no projeto sobe com as portas de sempre, sem pergunta.
- **RF3.2** Quando outra worktree do mesmo projeto já está rodando, o app propõe, antes de subir, uma porta livre para cada lado que tem servidor (API e Front) e mostra a porta padrão que ela substitui.
- **RF3.3** O usuário pode aceitar as portas propostas, editar cada uma ou cancelar. Cancelar não sobe nada e não para nada.
- **RF3.4** Antes de subir, o app confere se cada porta escolhida está livre. Se alguma estiver ocupada, ele diz qual e por quem (a worktree do projeto que a usa, quando for uma delas) e não sobe.
- **RF3.5** As portas confirmadas para uma worktree são lembradas. Da próxima vez que ela subir em paralelo, o app reaproveita as mesmas portas sem perguntar de novo, desde que estejam livres. Se alguma estiver ocupada, ele volta a propor.
- **RF3.6** A porta em uso aparece na faixa de destino de cada worktree, como hoje, e abre no navegador.
- **RF3.7** Quando o app não sabe a porta padrão de um lado (ele nunca subiu e não há como deduzir), ele pede a porta em vez de chutar.

### 4. Cada front na sua API

O que faz: o front de cada worktree recebe o endereço da API do mesmo par.
Por que importa: sem isso, o front de `feat/b` falaria com a API de `feat/a`, e testar a feature isolada perderia o sentido.

- **RF4.1** Quando a API de uma worktree sobe numa porta diferente da padrão, o front do mesmo par sobe apontando para essa API.
- **RF4.2** O diálogo de portas mostra que o front vai falar com a API escolhida (ex.: "Front → API na 3334").
- **RF4.3** Na worktree solo (só front), o front usa o endereço de API de sempre.
- **RF4.4** Se o projeto não tem como informar ao front o endereço da API, o app avisa antes de subir em vez de subir um front ligado à API errada sem dizer nada. O que é "não ter como" fica para o techspec definir.

### 5. Desligar o modo

O que faz: volta o projeto à regra de uma worktree rodando.
Por que importa: o modo é reversível, e desligar não pode deixar o projeto num estado que viola a regra.

- **RF5.1** Desligar com uma worktree ou nenhuma rodando só desliga.
- **RF5.2** Desligar com duas ou mais rodando pede confirmação e lista as worktrees que vão parar. Fica rodando só a que está na tela (ou, se a tela é de outro projeto, a última vista deste).
- **RF5.3** As que param seguem o mesmo caminho da parada de hoje (Ctrl+C, espera, SIGKILL no prazo), com o mesmo retorno visual.
- **RF5.4** Cancelar a confirmação deixa o modo ligado e nada para.
- **RF5.5** Depois de desligado, a próxima worktree que subir usa as portas padrão.

## Experiência do usuário

**Fluxo principal**

1. O usuário liga o modo paralelo no LEILAO.
2. Com `feat/a` rodando, ele clica em `feat/b` no painel.
3. A tela passa para `feat/b`, e um diálogo propõe "API: 3334 (padrão 3333) · Front: 3001 (padrão 3000) · Front → API na 3334".
4. Ele confirma com Enter. `feat/b` sobe (SUBINDO → RODANDO), e `feat/a` continua RODANDO no painel.
5. Ele alterna entre as duas pelo painel ou pela paleta. Nenhuma reinicia.
6. Ao fim do dia, ele desliga o modo. A confirmação lista `feat/a`, e só `feat/b`, que está na tela, fica de pé.

**Considerações**

- O painel continua sendo a verdade sobre o que roda (princípio 2 do produto). Várias linhas do mesmo projeto podem estar RODANDO, e a que está na tela precisa se distinguir das que rodam em segundo plano.
- A paleta deixa de dizer "Enter encerra" para o projeto em paralelo, e o leitor de tela ouve o mesmo.
- O diálogo de portas segue os formulários do app: Enter confirma, Esc cancela, foco visível, erros no campo da porta culpada.
- Contraste WCAG AA e foco visível em todos os controles novos, nos dois temas.
- Nada depende só de cor para dizer que um projeto está em paralelo.
- Interface em português do Brasil.

## Restrições técnicas de alto nível

- Com o modo desligado, o comportamento é idêntico ao atual. A feature não pode mudar nada para quem não liga o modo.
- Projetos reais usam `npm run dev` com Express/Fastify na API e Next.js no front, em layout git bare. A solução precisa funcionar com eles sem que o usuário mude o código dos projetos.
- Nunca subir um servidor numa porta que o app sabe estar ocupada.
- As preferências seguem morando na configuração do app que o usuário já edita, sem quebrar o arquivo existente.
- Sair do app e recarregar o webview continuam matando todos os PTYs, agora de todas as worktrees em paralelo.

## Fora de escopo

- **Terminais lado a lado:** a tela continua mostrando uma worktree por vez.
- **Isolar banco e serviços:** banco, Redis, filas etc. continuam compartilhados entre as worktrees.
- **Lembrar o conjunto ao abrir:** ao reabrir o app, volta só a última worktree ativa de cada projeto, como hoje, e não todas as que estavam de pé.
- **Teto de worktrees ou aviso de memória/CPU.**
- **Futuro:** portas por worktree também fora do modo paralelo, e isolamento de dados por worktree.

## Decisões existentes afetadas

Esta feature muda duas decisões de produto já implementadas e descritas fora de `specs/`:

- `PRODUCT.md` (Positioning) e `SPEC.md` (Terminais e ciclo de vida): "uma worktree ativa por projeto" passa a ser o padrão, e não uma regra absoluta.
- `SPEC.md` (Fora da v1): "injeção de porta por variável de ambiente" entra, restrita ao modo paralelo.

Os dois arquivos serão atualizados quando a feature for implementada (no `sdd-review`), para não descreverem um comportamento que o app ainda não tem.

## Histórico

**2026-10-22**. Documento criado.
