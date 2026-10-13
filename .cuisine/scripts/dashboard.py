#!/usr/bin/env python3
"""La Passe : tableau de bord de la cuisine, en une page HTML autonome (données et captures incluses),
à publier comme Artifact par la session opératrice. Usage : dashboard.py report.json sortie.html"""
import base64, html, json, os, re, sys

rep = json.load(open(sys.argv[1]))
out = sys.argv[2]
E = lambda s: html.escape(str(s if s is not None else ''))

NODE_FR = {'fix-back': 'réparation back', 'fix-gates': 'réparation portes', 'fix-final': 'réparation finale', 'fix-front': 'réparation front',
           'acceptance-fix': 'recette réécrite', 'matrix-fix': 'complétude', 'qa-arbitrate': 'arbitrage'}
GATE_FR = {'acceptance-run': 'recette', 'permissions-check': 'droits', 'contract-check': 'contrat', 'matrix-check': 'complétude',
           'check-back': 'tests back', 'check-front': 'build front', 'check-final': 'contrôle final', 'final-gates': 'portes finales',
           'red-check': 'recette au rouge', 'seal-check': 'scellé', 'acceptance-final': 'recette finale'}


def status_pill(v):
    s = v['statut']
    cls = {'ok': 'ok', 'en cours': 'run', 'non lancée': 'idle'}.get(s, 'ko')
    label = {'ok': 'Servie', 'en cours': 'En cuisine', 'non lancée': 'En attente'}.get(s, 'Interrompue')
    return f'<span class="pill {cls}">{label}</span>'


def gate_row(k, v):
    bad = any(w in v for w in ('KO', 'BLOCKED', ' failed')) or bool(re.search(r'[1-9]\d* bloquante', v))
    return f'<div class="gate"><span class="dot {"ko" if bad else "ok"}"></span><span class="gk">{E(k)}</span><span class="gv">{E(v)}</span></div>'


def version_card(i, v):
    rep_chips = ''.join(f'<span class="chip">{E(NODE_FR.get(n, n))} × {c}</span>' for n, c in v['reparations'].items()) or '<span class="muted">aucune</span>'
    fails = (''.join(f'<span class="chip warn">{E(GATE_FR.get(n, n))} × {c}</span>' for n, c in v['portes_echouees'].items())
             + ''.join(f'<span class="chip warn">{E(GATE_FR.get(n, n))} bloqué × {c}</span>' for n, c in v.get('portes_bloquees', {}).items())) or '<span class="muted">aucune</span>'
    disputes = ''.join(
        f'<li><span class="tag {"ok" if d.startswith("ACCEPTED") else "ko" if d.startswith("REJECTED") else "run"}">'
        f'{ {"ACCEPTED": "acceptée", "REJECTED": "rejetée", "OPEN": "ouverte"}[d.split(":")[0]] }</span>{E(d.split(":", 1)[1].strip()[:420])}</li>'
        for d in v['contestations']) or '<li class="muted">aucune</li>'
    inferred = ''.join(f'<li><code>{E(r)}</code></li>' for r in v['regles_inferees']) or '<li class="muted">aucune</li>'
    dur = f"{v['debut']} à {v['fin']}" if v['debut'] and v['fin'] else (v['debut'] or '')
    return f'''<article class="ver" id="v{i}">
  <header><div><div class="eyebrow">Version {i}</div><h3>{E(v["nom"])}</h3></div>{status_pill(v)}</header>
  <dl class="facts"><div><dt>Horaires</dt><dd>{E(dur) or "n.c."}</dd></div><div><dt>Étapes</dt><dd>{v["etapes"]}</dd></div>
  <div><dt>Contestations</dt><dd>{len(v["contestations"])}</dd></div><div><dt>Règles à valider</dt><dd>{len(v["regles_inferees"])}</dd></div></dl>
  <div class="row"><span class="rl">Réparations</span><div class="chips">{rep_chips}</div></div>
  <div class="row"><span class="rl">Portes passées au rouge</span><div class="chips">{fails}</div></div>
  <details><summary>Demande</summary><pre class="ask">{E(v["demande"])}</pre></details>
  <details><summary>Contestations ({len(v["contestations"])})</summary><ul class="disp">{disputes}</ul></details>
  <details{" open" if v["regles_inferees"] else ""}><summary>Règles déduites, à valider ({len(v["regles_inferees"])})</summary><ul class="inf">{inferred}</ul></details>
</article>'''


shots = []
for p in rep.get('captures', []):
    try:
        b = base64.b64encode(open(p, 'rb').read()).decode()
    except OSError:
        continue
    name = os.path.basename(p)[:-4]
    who = 'administrateur' if name.startswith('recette-admin') else 'utilisateur' if name.startswith('recette-user') else 'visiteur'
    page = re.sub(r'^recette-(admin|user)-', '', name).replace('_', '/') or '/'
    shots.append(f'<figure><img src="data:image/png;base64,{b}" alt="Page {E(page)} vue par un {who}" loading="lazy"><figcaption><b>{E(page)}</b> · {who}</figcaption></figure>')

served = sum(v['statut'] == 'ok' for v in rep['versions'])
alerts = ''.join(f'<li>{E(a)}</li>' for a in rep.get('alertes_droits', [])) or '<li class="muted">aucune</li>'
commits = ''.join(f'<tr><td class="mono">{E(c.split("|")[0])}</td><td>{E(c.split("|")[2])}</td><td>{E(c.split("|")[1])}</td><td>{E(c.split("|", 3)[3])}</td></tr>' for c in rep['commits'])
gates = ''.join(gate_row(k, v) for k, v in rep.get('portes', {}).items()) or '<p class="muted">Portes non rejouées : lancer <code>cuisine check</code>.</p>'
app = rep['application']

def couts_section():
    """Onglet Coûts : coût estimé par run, itérations avant le premier vert, portes signalées, propositions."""
    c = rep.get('couts')
    if not c:
        return '<section id="couts"><h2>Coûts</h2><p class="muted">Aucune mesure : lancer <code>cuisine couts</code>.</p></section>'
    usd = lambda x: f'{x:.2f} $' if isinstance(x, (int, float)) else 'inconnu'
    rows = ''.join(f'<tr><td>{E(k)}</td><td>{usd(r.get("cout_usd"))}</td><td>{(r.get("duree_ms") or 0) / 60000:.0f} min</td>'
                   f'<td>{r.get("visites_agent", 0)}</td><td>{E(r["iterations_avant_vert"] if r.get("iterations_avant_vert") is not None else "jamais vert")}</td>'
                   f'<td>{E(r.get("donnees", ""))}</td></tr>' for k, r in sorted(c['runs'].items()))
    est = ''.join(f'<span class="chip">{E(g)} : {E(usd(e["cout_median_usd"]) + " (p80 " + usd(e["cout_p80_usd"]) + ")" if e["statut"] == "estimé" else "non estimable")}</span>'
                  for g, e in sorted(c['estimation'].items()))
    portes = ''.join(f'<span class="chip">{E(GATE_FR.get(k, k))} : {E(", ".join(p["signaux"]))}</span>' for k, p in sorted(c['portes'].items())) or '<span class="muted">aucune</span>'
    props = ''.join(f'<li>{E(l)}</li>' for l in c['propositions']) or '<li class="muted">aucune</li>'
    return (f'<section id="couts"><h2>Coûts</h2><p class="muted">Montants estimés (grille tarifaire versionnée) ; seuils provisoires. '
            f'L\'outil mesure et propose ; il n\'applique rien.</p>'
            f'<div class="tbl"><table><tr><td>run</td><td>coût</td><td>durée</td><td>visites d\'agent</td><td>itérations avant vert</td><td>données</td></tr>{rows}</table></div>'
            f'<p>Estimation avant approbation : {est}</p><p>Portes signalées : {portes}</p><h3>Propositions</h3><ul class="al">{props}</ul></section>')


page = f'''<title>La Passe · {E(app)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Layout : la passe d'une cuisine, colonne unique ; bandeau d'état, puis une fiche par version, puis les captures de recette */
:root {{
  --bg: #f3f5f2; --surface: #ffffff; --fg: #1b2420; --muted: #5e6b65; --line: #dbe1dc;
  --accent: #2f6b4f; --accent-soft: #e2efe7;
  --ok: #2e7d4f; --ok-soft: #e1f2e7; --warn: #a86a12; --warn-soft: #fbefd9; --ko: #b3362b; --ko-soft: #f8e1de; --run: #2b5f9e; --run-soft: #e0eaf7;
  --display: "Bricolage Grotesque", "Segoe UI", system-ui, sans-serif; --body: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif; --mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
}}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{
  --bg: #121815; --surface: #1a221e; --fg: #e4ebe6; --muted: #9aa8a1; --line: #2c3731; --accent: #7cc3a0; --accent-soft: #1f3329;
  --ok: #7ccf9c; --ok-soft: #1c3326; --warn: #e3b45f; --warn-soft: #3a2d15; --ko: #ef8a80; --ko-soft: #3d1f1c; --run: #8fb8ee; --run-soft: #1b2a3e; color-scheme: dark }} }}
:root[data-theme="dark"] {{ --bg: #121815; --surface: #1a221e; --fg: #e4ebe6; --muted: #9aa8a1; --line: #2c3731; --accent: #7cc3a0; --accent-soft: #1f3329;
  --ok: #7ccf9c; --ok-soft: #1c3326; --warn: #e3b45f; --warn-soft: #3a2d15; --ko: #ef8a80; --ko-soft: #3d1f1c; --run: #8fb8ee; --run-soft: #1b2a3e; color-scheme: dark }}
* {{ box-sizing: border-box }}
body {{ background: var(--bg); color: var(--fg); font: 15px/1.55 var(--body); padding-inline: 16px; padding-block: 28px 56px }}
.wrap {{ max-width: 960px; margin: 0 auto; display: grid; gap: 28px }}
h1, h2, h3 {{ font-family: var(--display); letter-spacing: -0.01em; text-wrap: balance; margin: 0 }}
h1 {{ font-size: clamp(30px, 6vw, 44px); line-height: 1.05 }}
h2 {{ font-size: 21px; margin-bottom: 12px }}
h3 {{ font-size: 19px }}
.eyebrow {{ font: 500 11px/1 var(--mono); text-transform: uppercase; letter-spacing: .12em; color: var(--muted) }}
.muted {{ color: var(--muted) }}
code, .mono {{ font-family: var(--mono); font-size: 13px }}
.top {{ display: grid; gap: 10px }}
.top p {{ margin: 0; color: var(--muted) }}
.board {{ display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr); gap: 16px; align-items: start }}
@media (max-width: 720px) {{ .board {{ grid-template-columns: 1fr }} }}
.panel {{ background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 18px }}
.big {{ font: 700 44px/1 var(--display); font-variant-numeric: tabular-nums }}
.big small {{ font: 500 14px var(--body); color: var(--muted); margin-left: 6px }}
.gate {{ display: grid; grid-template-columns: 10px 110px minmax(0, 1fr); gap: 10px; align-items: baseline; padding: 6px 0; border-bottom: 1px dashed var(--line) }}
.gate:last-child {{ border-bottom: 0 }}
.dot {{ width: 10px; height: 10px; border-radius: 50%; display: inline-block }}
.dot.ok {{ background: var(--ok) }} .dot.ko {{ background: var(--ko) }}
.gk {{ font-weight: 600 }} .gv {{ font-family: var(--mono); font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere }}
.vers {{ display: grid; gap: 14px }}
.ver {{ background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 18px; display: grid; gap: 12px }}
.ver header {{ display: flex; justify-content: space-between; gap: 12px; align-items: start; flex-wrap: wrap }}
.pill {{ font: 600 12px/1 var(--body); padding: 6px 10px; border-radius: 999px; white-space: nowrap }}
.pill.ok {{ background: var(--ok-soft); color: var(--ok) }} .pill.ko {{ background: var(--ko-soft); color: var(--ko) }}
.pill.run {{ background: var(--run-soft); color: var(--run) }} .pill.idle {{ background: var(--accent-soft); color: var(--muted) }}
.facts {{ display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 0 }}
@media (max-width: 520px) {{ .facts {{ grid-template-columns: repeat(2, minmax(0, 1fr)) }} }}
.facts div {{ background: var(--bg); border-radius: 8px; padding: 8px 10px }}
.facts dt {{ font-size: 12px; color: var(--muted) }} .facts dd {{ margin: 0; font: 600 18px var(--display); font-variant-numeric: tabular-nums }}
.row {{ display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 10px; align-items: baseline }}
@media (max-width: 520px) {{ .row {{ grid-template-columns: 1fr; gap: 4px }} }}
.rl {{ font-size: 13px; color: var(--muted) }}
.chips {{ display: flex; flex-wrap: wrap; gap: 6px }}
.chip {{ font-size: 12.5px; padding: 3px 8px; border-radius: 6px; background: var(--accent-soft); color: var(--accent) }}
.chip.warn {{ background: var(--warn-soft); color: var(--warn) }}
details {{ border-top: 1px solid var(--line); padding-top: 10px }}
summary {{ cursor: pointer; font-weight: 600; font-size: 14px }}
summary:focus-visible {{ outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 4px }}
pre.ask {{ white-space: pre-wrap; font: 14px/1.6 var(--body); background: var(--bg); padding: 12px 14px; border-radius: 8px; margin: 10px 0 0; max-width: 72ch }}
ul.disp, ul.inf, ul.al {{ margin: 10px 0 0; padding-left: 0; list-style: none; display: grid; gap: 8px }}
ul.disp li {{ font-size: 13.5px; display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 8px }}
.tag {{ font: 600 11px/1.8 var(--body); text-align: center; border-radius: 4px; height: fit-content }}
.tag.ok {{ background: var(--ok-soft); color: var(--ok) }} .tag.ko {{ background: var(--ko-soft); color: var(--ko) }} .tag.run {{ background: var(--run-soft); color: var(--run) }}
ul.al li {{ font-family: var(--mono); font-size: 12.5px; background: var(--warn-soft); color: var(--fg); padding: 8px 10px; border-radius: 6px; overflow-wrap: anywhere }}
.shots {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px }}
figure {{ margin: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; overflow: hidden }}
figure img {{ display: block; width: 100%; height: auto; border-bottom: 1px solid var(--line) }}
figcaption {{ font-size: 13px; padding: 8px 10px; color: var(--muted) }} figcaption b {{ color: var(--fg); font-family: var(--mono); font-weight: 500 }}
.tbl {{ overflow-x: auto }} table {{ border-collapse: collapse; width: 100%; font-size: 13.5px }}
td {{ padding: 7px 8px; border-bottom: 1px solid var(--line); vertical-align: top }} td:nth-child(2), td:nth-child(3) {{ white-space: nowrap; color: var(--muted) }}
</style>
<div class="wrap">
  <section class="top">
    <div class="eyebrow">Cuisine sauvage · la passe</div>
    <h1>{E(app)}</h1>
    <p>État au {E(rep["genere"])} · dernier commit <code>{E(rep["commit"])}</code></p>
  </section>
  <section class="board">
    <div class="panel"><div class="eyebrow">Versions servies</div><div class="big">{served}<small>sur {len(rep["versions"])}</small></div></div>
    <div class="panel"><div class="eyebrow">Portes, dernier passage complet</div>{gates}</div>
  </section>
  <section><h2>Versions</h2><div class="vers">{"".join(version_card(i + 1, v) for i, v in enumerate(rep["versions"]))}</div></section>
  <section><h2>Droits à arbitrer</h2><ul class="al">{alerts}</ul></section>
  <section><h2>Recette sur captures</h2><div class="shots">{"".join(shots) or '<p class="muted">Aucune capture : lancer <code>cuisine shots</code>.</p>'}</div></section>
  {couts_section()}
  <section><h2>Derniers commits</h2><div class="tbl"><table>{commits}</table></div></section>
</div>
'''
open(out, 'w').write(page)
print(out, f'{os.path.getsize(out) // 1024} Ko')
