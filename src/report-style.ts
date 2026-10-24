// Shared report layout approved in the Chinese HTML prototypes.
export const reportStyle = String.raw`

    :root {
  color-scheme:light;
  --ink:#18243b;
  --muted:#69758a;
  --line:#e2e7ef;
  --blue:#4668d8;
  --purple:#8b6bc0;
  --teal:#31958d;
  --green:#20735d;
  --orange:#a76521
}

    * {
  box-sizing:border-box
}
body {
  margin:0;
  background:#f5f7fb;
  color:var(--ink);
  font:14px/1.5 "Segoe UI",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased
}
a {
  color:#4262bd;
  text-decoration:none
}
a:hover {
  text-decoration:underline
}
main {
  max-width:1240px;
  margin:auto;
  padding:28px 32px 38px
}
.masthead {
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding-bottom:22px;
  border-bottom:1px solid var(--line)
}
.brand {
  display:flex;
  gap:10px;
  align-items:center;
  font-weight:650;
  letter-spacing:-.2px;
  font-size:15px
}
.brand-icon {
  display:grid;
  place-items:center;
  width:29px;
  height:29px;
  border-radius:8px;
  background:var(--ink);
  color:white;
  font-size:18px
}
.masthead-right {
  font-size:12px;
  color:var(--muted);
  display:flex;
  gap:20px;
  align-items:center
}
.status {
  color:var(--green);
  display:flex;
  gap:7px;
  align-items:center
}
.status:before {
  content:"";
  width:6px;
  height:6px;
  background:#40987b;
  border-radius:50%
}
.hero {
  display:flex;
  justify-content:space-between;
  align-items:center;
  padding:29px 0 24px
}
.eyebrow {
  font-size:11px;
  font-weight:650;
  letter-spacing:1.5px;
  text-transform:uppercase;
  color:var(--muted);
  margin-bottom:5px
}
h1 {
  font-size:32px;
  line-height:1.25;
  letter-spacing:-1px;
  margin:0 0 8px;
  font-weight:650
}
.subtitle {
  color:var(--muted);
  margin:0;
  font-size:14px
}
.scene {
  font-size:12px;
  border:1px solid #d7e0f4;
  background:#edf2fe;
  color:#4861a4;
  border-radius:7px;
  padding:7px 11px;
  white-space:nowrap
}
.run-facts {
  display:flex;
  gap:0;
  margin-bottom:24px;
  color:var(--muted);
  font-size:12px
}
.run-facts span {
  padding:0 20px;
  border-left:1px solid #d9dfeb
}
.run-facts span:first-child {
  padding-left:0;
  border-left:0
}
.run-facts strong {
  color:var(--ink);
  font-weight:600
}
.card {
  background:white;
  border:1px solid var(--line);
  border-radius:13px;
  box-shadow:0 3px 14px #23324d04;
  overflow:hidden
}
.card-heading {
  display:flex;
  justify-content:space-between;
  gap:20px;
  align-items:center;
  padding:19px 24px;
  border-bottom:1px solid var(--line)
}
h2 {
  font-size:15px;
  font-weight:650;
  margin:0
}
.card-heading p {
  font-size:12px;
  color:var(--muted);
  margin:0
}
.comparison {
  width:100%;
  border-collapse:collapse;
  table-layout:fixed
}
.comparison th,.comparison td {
  padding:20px 24px;
  text-align:left;
  border-right:1px solid #edf0f5;
  vertical-align:middle
}
.comparison th:last-child,.comparison td:last-child {
  border-right:0
}
.comparison thead th {
  font-weight:400;
  border-bottom:1px solid var(--line);
  padding-top:20px;
  padding-bottom:18px
}
.comparison th:first-child {
  width:27%
}
.comparison tbody tr+tr {
  border-top:1px solid var(--line)
}
.baseline-column {
  background:#f8faff
}
.version-line {
  display:flex;
  align-items:center;
  gap:7px
}
.dot {
  display:inline-block;
  width:7px;
  height:7px;
  border-radius:50%;
  flex-shrink:0
}
.v1 {
  background:var(--blue)
}
.v2 {
  background:var(--purple)
}
.v3 {
  background:var(--teal)
}
.version {
  font-size:17px;
  font-weight:650;
  letter-spacing:-.3px
}
.version-note {
  display:block;
  font-size:11px;
  color:var(--muted);
  margin-top:5px;
  overflow-wrap:anywhere
}
.baseline-badge {
  color:#526cb6;
  font-size:10px;
  font-weight:600;
  background:#eaf0ff;
  padding:2px 6px;
  border-radius:4px;
  margin-left:4px
}
.column-label {
  font-size:12px;
  color:var(--muted)
}
.metric-title {
  font-weight:600;
  font-size:15px
}
.metric-description {
  font-size:12px;
  color:var(--muted);
  max-width:220px;
  margin-top:5px;
  line-height:1.6
}
.metric-number {
  font-size:30px;
  line-height:1.15;
  letter-spacing:-.9px;
  font-weight:600;
  font-variant-numeric:tabular-nums
}
.unit {
  font-size:13px;
  font-weight:400;
  letter-spacing:0;
  color:var(--muted);
  margin-left:5px
}
.delta-line {
  display:flex;
  gap:9px;
  align-items:center;
  font-size:11px;
  margin-top:10px;
  font-variant-numeric:tabular-nums;
  min-height:22px
}
.delta {
  font-size:11px;
  line-height:1.5;
  font-weight:650;
  border-radius:4px;
  padding:2px 6px
}
.up {
  background:#fff4e7;
  color:var(--orange)
}
.down {
  background:#eaf6f0;
  color:var(--green)
}
.delta-absolute,.reference {
  color:var(--muted)
}
.bar-track {
  height:5px;
  background:#edf1f7;
  border-radius:4px;
  margin-top:16px;
  overflow:hidden;
  max-width:195px
}
.bar {
  height:100%;
  border-radius:4px
}
.table-note {
  padding:13px 24px;
  border-top:1px solid var(--line);
  font-size:11px;
  color:var(--muted);
  background:#fcfdff
}
.sample-note {
  display:flex;
  gap:10px;
  align-items:center;
  padding:14px 2px 20px;
  font-size:12px;
  color:var(--muted)
}
.info {
  display:grid;
  place-items:center;
  border:1px solid #b6c0d2;
  width:15px;
  height:15px;
  border-radius:50%;
  font-size:10px;
  flex-shrink:0
}
.details-stack {
  display:grid;
  gap:9px
}
.detail {
  background:white;
  border:1px solid var(--line);
  border-radius:9px;
  overflow:hidden
}
.detail>summary {
  list-style:none;
  display:flex;
  gap:12px;
  align-items:center;
  justify-content:space-between;
  padding:15px 20px;
  cursor:pointer
}
.detail>summary::-webkit-details-marker {
  display:none
}
.detail>summary:focus-visible {
  outline:2px solid var(--blue);
  outline-offset:-3px
}
.detail-label {
  font-size:13px;
  font-weight:600;
  display:flex;
  gap:12px;
  align-items:center
}
.chevron {
  width:7px;
  height:7px;
  border-right:1.5px solid #8590a4;
  border-bottom:1.5px solid #8590a4;
  transform:rotate(-45deg);
  transition:transform .15s
}
.detail[open]>summary .chevron {
  transform:rotate(45deg)
}
.detail-hint {
  font-size:11px;
  color:var(--muted);
  font-weight:400
}
.detail-body {
  padding:4px 20px 22px;
  border-top:1px solid var(--line)
}
.detail-body p {
  color:var(--muted);
  font-size:12px;
  margin:15px 0
}
.data-table {
  width:100%;
  border-collapse:collapse;
  font-size:12px;
  margin-top:14px
}
.data-table th,.data-table td {
  text-align:left;
  padding:11px 13px;
  border-bottom:1px solid #edf0f5;
  font-variant-numeric:tabular-nums
}
.data-table th {
  background:#f8f9fc;
  color:var(--muted);
  font-weight:500
}
.data-table td:not(:first-child),.data-table th:not(:first-child) {
  text-align:right
}
.label {
  color:var(--muted);
  font-weight:400;
  font-size:11px;
  margin-left:5px
}
.env-grid {
  display:grid;
  grid-template-columns:1fr 1fr 1fr;
  gap:18px;
  margin:20px 0
}
.env-grid dt {
  font-size:11px;
  color:var(--muted);
  margin-bottom:4px
}
.env-grid dd {
  margin:0;
  font-size:12px;
  font-weight:500
}
.target-card {
  padding:14px 0;
  border-top:1px solid #edf0f5
}
.target-card strong {
  font-size:12px
}
.path {
  font:11px/1.8 Consolas,monospace;
  color:var(--muted);
  overflow-wrap:anywhere;
  margin-top:5px
}
.nested {
  margin-top:16px;
  font-size:12px
}
.nested summary {
  cursor:pointer;
  color:var(--muted)
}
footer {
  display:flex;
  justify-content:space-between;
  gap:15px;
  padding-top:21px;
  font-size:11px;
  color:#8590a3
}
.footer-links {
  display:flex;
  gap:18px
}

    @media(max-width:800px) {
  main {
  padding:20px 16px
}
.hero {
  align-items:flex-start;
  gap:12px
}
h1 {
  font-size:26px
}
.run-facts {
  flex-wrap:wrap;
  gap:8px
}
.run-facts span {
  padding:0 10px
}
.comparison-wrapper {
  overflow:auto
}
.comparison {
  min-width:760px
}
.card-heading {
  align-items:flex-start
}
.detail-hint {
  max-width:45%;
  text-align:right
}
.env-grid {
  grid-template-columns:1fr 1fr
}
.masthead-right time {
  display:none
}
.metric-number {
  font-size:26px
}
footer {
  flex-wrap:wrap
}

}

    @media print {
  body {
  background:white
}
main {
  max-width:none;
  padding:0
}
.card,.detail {
  box-shadow:none;
  break-inside:avoid
}

}



body {
  font-family:"Segoe UI","Microsoft YaHei UI","Microsoft YaHei",system-ui,sans-serif
}
.metric-description {
  font-weight:400
}
.hero {
  padding:24px 0 20px
}
h1 {
  letter-spacing:-.5px;
  font-size:30px
}
.eyebrow {
  font-size:12px;
  letter-spacing:1px
}

.run-facts span {
  padding:0 16px
}

.scene {
  font-size:12px
}

.single-grid {
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:18px
}
.single-card {
  background:white;
  border:1px solid var(--line);
  border-radius:12px;
  overflow:hidden
}
.single-heading {
  display:flex;
  justify-content:space-between;
  align-items:center;
  padding:17px 22px;
  border-bottom:1px solid var(--line);
  gap:10px
}
.single-heading h2 {
  font-size:14px
}
.single-heading span {
  font-size:11px;
  color:var(--muted)
}
.metric-card {
  padding:25px 26px
}
.metric-card h2 {
  font-size:15px;
  font-weight:600
}
.single-value {
  font-size:46px;
  line-height:1.25;
  letter-spacing:-1.3px;
  font-weight:600;
  font-variant-numeric:tabular-nums;
  margin-top:17px
}
.single-value .unit {
  font-size:16px;
  letter-spacing:0;
  margin-left:8px
}

.metric-card .metric-description {
  max-width:none;
  margin-top:19px;
  padding-top:17px;
  border-top:1px solid #edf0f5
}
.card-context {
  display:flex;
  justify-content:space-between;
  font-size:11px;
  color:var(--muted);
  margin-top:13px
}
.single-metric-row {
  display:flex;
  justify-content:space-between;
  gap:18px;
  padding:15px 22px;
  border-bottom:1px solid #edf0f5;
  align-items:center
}
.single-metric-row:last-child {
  border-bottom:0
}
.single-metric-label {
  font-size:13px;
  font-weight:500
}
.single-metric-row .metric-description {
  font-size:11px;
  max-width:270px;
  margin-top:4px
}
.single-metric-value {
  text-align:right;
  white-space:nowrap
}
.single-metric-value .metric-number {
  font-size:25px
}

.single-metric-value .unit {
  font-size:11px
}
.single-section-note {
  font-size:11px;
  color:var(--muted);
  padding:12px 22px;
  border-top:1px solid var(--line);
  background:#fcfdff
}
.group-row th {
  padding:10px 22px!important;
  background:#f3f6fb!important;
  border-bottom:1px solid var(--line);
  font-size:12px;
  font-weight:600
}
.group-row small {
  font-size:11px;
  font-weight:400;
  color:var(--muted);
  margin-left:13px
}
.all-matrix .comparison td,.all-matrix .comparison tbody th[scope=row] {
  padding:13px 22px
}
.all-matrix .metric-number {
  font-size:25px
}
.all-matrix .metric-title {
  font-size:13px
}
.all-matrix .metric-description {
  font-size:11px;
  margin-top:3px;
  max-width:245px
}
.all-matrix .delta-line {
  margin-top:6px;
  min-height:18px;
  gap:7px
}
.all-matrix .delta {
  font-size:10px;
  padding:1px 5px
}
.all-matrix .delta-absolute,.all-matrix .reference {
  font-size:10px
}
.all-matrix .unit {
  font-size:11px
}
.comparison thead th {
  padding:17px 22px
}
.comparison th:first-child {
  width:28%
}
.sample-note {
  font-size:12px;
  padding:13px 2px 18px
}
.metric-title {
  font-weight:550
}
.version {
  font-size:16px
}

.empty-detail {
  font-size:12px;
  line-height:1.8;
  padding:17px 0 0;
  color:var(--muted)
}

.data-table td:first-child {
  white-space:nowrap
}
.data-table {
  font-size:12px
}

footer {
  padding-top:18px
}
.run-facts {
  margin-bottom:20px;
  font-size:12px
}

@media(max-width:800px) {
  .single-grid {
  grid-template-columns:1fr
}
.run-facts span {
  padding:0 9px
}

.group-row small {
  display:block;
  margin-left:0
}

.version {
  font-size:15px
}

}

.statistic-heading {
  display:flex;
  align-items:center;
  justify-content:space-between;
  margin:0 0 13px;
  gap:12px
}
.statistic-heading h2 {
  font-size:14px;
  font-weight:600
}
.statistic-heading span {
  font-size:12px;
  color:var(--muted)
}
.statistic-heading strong {
  color:#405cb3;
  font-weight:600
}

.status.problem{color:#a76521}.status.problem:before{background:#a76521}
.report-alert{padding:13px 17px;margin-bottom:17px;border:1px solid #efcfb4;border-radius:8px;background:#fff8f0;color:#865829;font-size:12px;overflow-wrap:anywhere}
.metric-empty{color:#96a0b1;font-size:27px}.metric-unavailable{color:#7b8494;font-size:11px;margin-top:7px}
.delta.neutral{color:#69758a;background:#edf1f6}.data-table .result-list{text-align:left;min-width:250px;white-space:normal}.result-list span{display:inline-block;margin-right:13px;line-height:1.9}
.failure-row td{background:#fffaf5}.detail-body dd{overflow-wrap:anywhere}.metric-description{font-weight:400}.single-grid{align-items:start}.single-metric-row{min-height:77px}
.comparison{min-width:var(--table-width,760px)}.comparison-wrapper{overflow-x:auto}.comparison .version{overflow-wrap:anywhere}.comparison .group-row th{width:auto}
.footer-links{flex-wrap:wrap}.phase-detail-row th{text-align:left!important;background:#f0f4fb}
.single-value .metric-number{font-size:46px;font-weight:600;line-height:1.25}
`;
