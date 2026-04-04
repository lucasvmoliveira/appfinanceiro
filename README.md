# Fluxo

Aplicação estática de **controle financeiro pessoal** em português: receitas e despesas **categorizadas**, **mês a mês**, distinção entre **previsto** e **realizado**, **saldo acumulado** com saldo inicial configurável, **recorrência mensal** (ex.: aluguel) e **gráficos** de fluxo, projeção e categorias.

Os dados ficam no **localStorage** do navegador. Use **Exportar JSON** para backup.

## Publicar no GitHub Pages

1. Crie um repositório e envie a pasta do projeto (`index.html`, `css/`, `js/`).
2. No GitHub: **Settings → Pages → Build and deployment → Source**: *Deploy from a branch*.
3. Branch **main** (ou `master`), pasta **`/(root)`**, salve.
4. O site ficará em `https://<usuario>.github.io/<repositorio>/`.

Abra sempre o `index.html` pela URL do Pages (ou um servidor local); abrir o arquivo direto do disco (`file://`) pode limitar alguns recursos.

## Uso rápido

- Defina **Saldo inicial** (patrimônio líquido antes do primeiro mês com lançamentos).
- Lançamentos **mensais** repetem automaticamente nos totais e na **projeção** a partir do mês de referência.
- **Realizar** converte um lançamento previsto em realizado (pago/recebido).
