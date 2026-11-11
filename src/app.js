(() => {
  "use strict";
  let api = window.Workbench;
  const el = id => document.getElementById(id);
  const safe = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const format = n => n.toLocaleString("zh-CN");
  const pageSize = 25;
  const edits = new Map();
  const groupRules = loadGroupRules();
  const leads = new Map();
  let workbook, result, filename, busy = false, view = "dashboard", page = 0, search = "";
  let downloadUrl;
  const priorityCategories = new Set();
  let rankingText = ["",""];
  let priorityInitialized = false;
  let saveDialog = null;
  function loadGroupRules() {
    try { return new Map(JSON.parse(localStorage.getItem("main-venue-group-rules-v1") ?? "[]")); }
    catch { return new Map(); }
  }
  function storeGroupRules() {
    try { localStorage.setItem("main-venue-group-rules-v1",JSON.stringify([...groupRules])); }
    catch { /* Current-session rules remain available if browser storage is restricted. */ }
  }
  const status = (message, error = false) => {
    el("message").textContent = message;
    el("message").classList.toggle("error",error);
  };
  function applyConfig(config) {
    const strings = a=>Array.isArray(a) && a.length && a.every(v=>typeof v==="string");
    const mapping = m=>m && typeof m==="object" && !Array.isArray(m) && Object.values(m).every(v=>typeof v==="string");
    const templateValid=typeof config?.template==="string" && /^UEsD[A-Za-z0-9+/=]+$/.test(config.template);
    const widthsValid=Array.isArray(config?.columnWidths) && config.columnWidths.length===22 &&
      config.columnWidths.every(width=>typeof width==="number" && width>=1 && width<=255);
    if (config?.version!==1 || config.headers?.length!==22 || !strings(config.headers) ||
        config.options?.length!==5 || !config.options.every(strings) || !strings(config.inviters) ||
        !mapping(config.industryAliases) || !mapping(config.companyAliases) ||
        !(templateValid || widthsValid)) throw new Error("Invalid workbench configuration");
    api=window.createWorkbench(config);
    el("file").disabled=false;
    el("setup-rules").hidden=true;
  }
  async function loadSharedConfig(token) {
    if (!/^[A-Za-z0-9_-]{50,20000}$/.test(token)) throw new Error("Invalid workbench link");
    const encoded=token.replace(/-/g,"+").replace(/_/g,"/");
    const zip=await JSZip.loadAsync(encoded.padEnd(Math.ceil(encoded.length/4)*4,"="),{base64:true});
    const config=zip.file("rules.json");
    if (!config) throw new Error("Missing workbench configuration");
    applyConfig(JSON.parse(await config.async("string")));
    el("home").href="#setup="+token;
    status("工作台已就绪。请选择当天的 Excel。");
  }
  if (!api) {
    el("file").disabled = true;
    const token=new URLSearchParams(window.location.hash.slice(1)).get("setup");
    if (token) {
      status("正在打开工作台…");
      loadSharedConfig(token).catch(()=>{
        el("setup-rules").hidden=false;
        status("专用链接无法打开。请检查网址是否完整，或向经办人获取新链接。",true);
      });
    } else {
      el("setup-rules").hidden=false;
      status("请使用经办人发给你的专用链接。也可以手动选择工作台配置 JSON。");
    }
  }
  el("rules-file").addEventListener("change",async event=>{
    const file=event.target.files[0];
    if (!file || api) return;
    try {
      if (file.size > 1024*1024) throw new Error();
      applyConfig(JSON.parse(await file.text()));
      status("配置已加载。请选择当天的 Excel。");
    } catch {
      status("配置文件无法读取，请选择经办人提供的工作台配置 JSON。",true);
    } finally {event.target.value="";}
  });
  const fileDate = name => {
    const match = /(20\d{2})(\d{2})(\d{2})/.exec(name);
    const candidate = match ? match.slice(1).join("-") : new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Shanghai"}).format(new Date());
    const d = new Date(candidate+"T00:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(candidate) ? candidate : "";
  };
  async function openFile(file) {
    if (!file || busy) return;
    if (!api) {status("请先选择工作台配置 JSON。",true);return;}
    if (!/\.xlsx$/i.test(file.name) || file.size > 25 * 1024 * 1024) {
      status("请选择 25 MB 以内的 .xlsx 文件。", true);
      return;
    }
    busy = true;
    el("download").disabled = true;
    status("正在读取表头、邀请单位分组和嘉宾明细…");
    try {
      await new Promise(resolve => setTimeout(resolve,20));
      const imported = await api.readExcel(await file.arrayBuffer());
      workbook = imported;
      filename = file.name;
      edits.clear();
      leads.clear();
      el("date").value = fileDate(filename);
      el("file-label").textContent = file.name;
      el("batch").textContent = workbook.name;
      el("intro").hidden = true;
      el("workspace").hidden = false;
      setView("dashboard");
      refresh();
      status("导入成功。可直接下载整理稿，或先复核标记的记录。");
    } catch (error) {
      status(error instanceof Error ? error.message : "读取失败，请检查 Excel 文件。",true);
    } finally {
      busy = false;
      el("download").disabled = false;
      el("file").value = "";
    }
  }
  el("file").addEventListener("change",event=>openFile(event.target.files[0]));
  const drop = el("drop");
  drop.addEventListener("dragover",event=>{event.preventDefault();drop.classList.add("over");});
  drop.addEventListener("dragleave",()=>drop.classList.remove("over"));
  drop.addEventListener("drop",event=>{event.preventDefault();drop.classList.remove("over");openFile(event.dataTransfer.files[0]);});
  function updateReport() {
    if (!result) return;
    el("report-text").value = api.dailySummary(result,el("date").value);
    el("report-status").textContent = "";
  }
  el("date").addEventListener("change",updateReport);
  el("copy-report").addEventListener("click",async ()=>{
    const text = el("report-text");
    try {
      await navigator.clipboard.writeText(text.value);
      el("report-status").textContent = "已复制汇报摘要。";
    } catch {
      text.focus();
      text.select();
      el("report-status").textContent = "已选中摘要，请按 Ctrl+C 或 ⌘C 复制。";
    }
  });
  function refresh() {
    clearDownloadLink();
    result = api.process(workbook.records,edits,groupRules,leads);
    updateReport();
    const c = result.counts;
    el("metrics").innerHTML = '<article class="metric"><span>确认参会企业集团</span><strong>'+format(result.confirmedEnterprises.length)+'</strong><div class="metric-actions"><button type="button" id="export-confirmed-card" class="button primary">导出确认企业 Excel ↓</button><button type="button" id="open-confirmed" class="metric-detail">查看明细 →</button></div></article>' + [
      ["国内企业",c.domestic],["外资企业（含港澳台）",c.foreign],
      ["招商合作机构",c.partners],["确认企业内外资待核对",result.confirmedEnterprises.length-c.domestic-c.foreign]
    ].map(([label,count])=>'<article class="metric"><span>'+safe(label)+'</span><strong>'+format(count)+'</strong></article>').join("");
    el("open-confirmed").addEventListener("click",()=>{setView("confirmed");render();});
    el("export-confirmed-card").disabled = !result.confirmedEnterprises.length;
    el("export-confirmed-card").addEventListener("click",()=>download(true));
    el("batch-info").textContent = filename + " · 排除样例 " + format(workbook.excludedExamples) + " 行 · 有效明细 " + format(workbook.records.length) + " 行 · 整理后 " + format(result.rows.length) + " 行";
    el("count-note").textContent = "已合并 " + result.removed + " 条重复明细。企业意向按姓名和职务确认，嘉宾资料另核对国籍。";
    el("review-count").textContent = result.notices.length ? format(result.notices.length) : "";
    el("download").textContent = result.notices.length ? "下载 Excel（含待复核）" : "下载 Excel";
    render();
  }
  function setView(next) {
    view = next;
    el("report-panel").hidden = next !== "dashboard";
    page = 0;
    search = "";
    document.querySelectorAll("[data-view]").forEach(button=>{
      const selected = button.dataset.view === view;
      button.classList.toggle("current",selected);
      button.setAttribute("aria-pressed",String(selected));
    });
  }
  document.querySelectorAll("[data-view]").forEach(button=>button.addEventListener("click",()=>{setView(button.dataset.view);render();}));
  const table = (head, rows, empty) => rows.length ? '<div class="table-wrap"><table><thead><tr>'+head.map(h=>'<th scope="col">'+safe(h)+'</th>').join("")+'</tr></thead><tbody>'+rows.map(row=>"<tr>"+row.map(cell=>"<td>"+cell+"</td>").join("")+"</tr>").join("")+"</tbody></table></div>" : '<p class="empty">'+safe(empty)+'</p>';
  const button = (label, action, value) => '<button class="button" type="button" data-'+action+'="'+safe(value)+'">'+safe(label)+'</button>';
  const chip = ok => '<span class="tag'+(ok?"":" pending")+'">'+(ok?"意向确认":"待确认")+'</span>';
  const guestChip = complete => '<span class="tag'+(complete?"":" pending")+'">'+(complete?"嘉宾资料齐全":"嘉宾资料待补")+'</span>';
  function render() {
    if (!result) return;
    const content = el("content");
    if (view === "priority") {renderPriority(content);return;}
    if (view === "ranking") {renderRankingAudit(content);return;}
    if (view === "dashboard") {
      const bars = [...result.counts.countries].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0],"zh"));
      const max = bars[0]?.[1] ?? 1;
      const barsHtml = bars.map(([country,count])=>'<div class="bar"><span>'+safe(country)+'</span><i aria-hidden="true"><span style="width:'+Math.round(count/max*100)+'%"></span></i><strong>'+count+'</strong></div>').join("");
      const duplicateRows = result.duplicates.map(g=>[g.name,[...g.units.keys()].join(" ")]);
      const unitMax = Math.max(1,...result.units.map(u=>u.confirmed+u.pending));
      const unitRows = [...result.units].sort((a,b)=>b.confirmed-a.confirmed || b.pending-a.pending).map(u=>[
        safe(u.name),'<span class="unit-count">'+format(u.confirmed)+'</span>','<span class="pending-count">'+format(u.pending)+'</span>',
        '<div class="unit-bars" aria-hidden="true"><span style="width:'+u.confirmed/unitMax*100+'%"></span><span style="width:'+u.pending/unitMax*100+'%"></span></div>'
      ]);
      content.innerHTML = '<div class="unit-grid"><section class="panel"><h3>外资集团国别分布</h3><p class="small muted">确认参会意向的外资集团，含港澳台</p><div class="bar-list">'+(barsHtml || '<span class="empty">暂无已确认外资集团。</span>')+'</div></section><section class="panel"><h3>各邀请单位企业进度</h3><p class="small muted">单位内按企业集团去重。有姓名和职务的为确认，同一单位同一集团只计一次。</p>'+table(["邀请单位","确认","待确认","进度分布"],unitRows,"暂无邀请单位统计。")+'</section></div><section class="panel"><h3>跨单位重复邀请 · '+result.duplicates.length+' 家</h3><p class="small muted">含待确认记录。每个集团下列出全部邀请来源。</p>'+controls()+'<div id="listing"></div></section>';
      content.insertAdjacentHTML("afterbegin",'<section class="panel panel-heading"><div><h3>重点企业候选</h3><p class="small muted">按企业类别筛选，查看嘉宾职级和榜单核验结果。</p></div><button id="open-priority" type="button" class="button primary">查看重点企业</button></section>');
      el("open-priority").addEventListener("click",()=>{setView("priority");render();});
      attachListing(duplicateRows, visible=>table(["集团","邀请单位及嘉宾"],visible.map(index=>{
        const g = result.duplicates[index];
        return [safe(g.name),[...g.units].map(([unit,guests])=>'<div><strong>'+safe(unit)+'</strong><br>'+guests.map(d=>safe([d.guest,d.position].filter(Boolean).join(" · ") || "嘉宾待定")+" "+chip(d.confirmed)).join("<br>")+"</div>").join("<br>")];
      }),"未发现跨单位重复邀请。"));
      return;
    }
    if (view === "confirmed") {
      const groups = result.confirmedEnterprises;
      content.innerHTML = '<section class="panel"><div class="panel-heading"><div><h3>确认参会企业集团 · '+format(groups.length)+' 家</h3><p class="small muted">企业至少有一位嘉宾填了姓名和职务。国籍缺失的嘉宾仍可补录。</p></div><button type="button" id="download-confirmed" class="button primary">导出确认集团 Excel</button></div>'+controls()+'<div id="listing"></div></section>';
      el("download-confirmed").disabled = !groups.length;
      el("download-confirmed").addEventListener("click",()=>download(true));
      attachListing(groups.map(g=>[g.name,...g.locations,...g.units,...[...g.guests.values()].map(r=>r.slice(8,11).join(" "))]), visible=>table(
        ["集团","国别（地区）","嘉宾资料","确认来源"],
        visible.map(i=>{
          const g=groups[i];
          return [safe(g.name),safe([...g.locations].join("、"))||"—",[...g.guests.values()].map(r=>safe([r[8],r[9],r[10]].filter(Boolean).join(" · "))+" "+guestChip(api.guestComplete(r))).join("<br>"),safe([...g.units].join("、"))||"—"];
        }),"暂无符合条件的确认参会企业。"));
      return;
    }
    const names = [...result.groupInputs.values()];
    const views = {
      review: {
        title:"待复核事项", hint:"按原表行号定位。可更正字段、选择牵头单位，或在确认重复后排除一行。",
        data:result.notices.map(n=>[n.line,n.label,n.value,workbook.records.find(r=>r.line===n.line)?.values[1]]),
        display:index=>{ const n=result.notices[index];return [safe(n.line),safe(n.label),safe(n.value)||"—",button("复核","edit",n.line)]; },
        columns:["原表行","事项","原填值／冲突内容","操作"], empty:"当前没有待复核事项。"
      },
      names: {
        title:"集团名称", hint:"按原名称或集团搜索。确认子公司、简称归属后统一集团名。浏览器允许保存时，名称映射可在此设备后续批次复用。",
        data:names.map(n=>[n.original,n.location,n.group]),
        display:index=>{const n=names[index];return [safe(n.original),safe(n.location)||"—",safe(n.group)+(n.suggestions.length?'<br><span class="tag pending">有相似集团名</span>':""),button("统一名称","group",index)];},
        columns:["原参会单位","国别（地区）","输出集团名","操作"],empty:"未找到匹配的单位。"
      },
      detail: {
        title:"整理明细",hint:"按模板导出的嘉宾行。跨单位合并后，全部来源仍可在看板查询。",
        data:result.rows.map(r=>[r.values[1],r.values[2],r.values[8],r.values[9],r.values[13],r.lines.join(" ")]),
        display:index=>{const r=result.rows[index];return [safe(r.values[1]),safe(r.values[2]),safe(r.values[8])||"—",safe(r.values[9])||"—",safe(r.values[10])||"—",safe(r.values[13]),chip(api.confirmed(r.values))+" "+guestChip(api.guestComplete(r.values)),button("查看／复核","edit",r.lines[0])];},
        columns:["参会集团","名牌简称","嘉宾","职务","国籍","牵头邀请单位","状态","操作"],empty:"未找到匹配的明细。"
      }
    };
    const current = views[view];
    content.innerHTML = '<section class="panel"><h3>'+safe(current.title)+'</h3><p class="muted small">'+safe(current.hint)+'</p>'+controls()+'<div id="listing"></div></section>';
    attachListing(current.data,visible=>table(current.columns,visible.map(current.display),current.empty));
    content.onclick = event => {
      const edit = event.target.closest("[data-edit]");
      const group = event.target.closest("[data-group]");
      if (edit) showEditor(Number(edit.dataset.edit));
      if (group) showGroup(names[Number(group.dataset.group)]);
    };
  }
  function parseRanking(text) {
    return text.split(/\r?\n/).filter(line=>line.trim()).map((line,index)=>{
      const [rank,name,...aliases] = line.split("\t").map(value=>value.trim());
      if (["排名","名次","序号"].includes(rank)) return null;
      if (!/^\d+$/.test(rank) || Number(rank)<1 || Number(rank)>500 || !name) throw Error("第 "+(index+1)+" 行需要包含名次和企业名称。");
      return {rank:Number(rank),name,aliases:aliases.filter(Boolean)};
    }).filter(Boolean);
  }
  function renderRankingAudit(content) {
    const fields = api.rankingLabels.map((label,i)=>'<label>'+safe(label)+'<textarea data-ranking="'+i+'" rows="3">'+safe(rankingText[i])+'</textarea></label>').join("");
    content.innerHTML = '<section class="panel priority"><h3>全局榜单核验</h3><p class="small muted">核验本次导入的全部企业集团，包含待确认参会企业。可从 Excel 粘贴「名次」「企业名称」两列，右侧可附加已核实的别名。</p>'+
      '<details'+(!rankingText.some(Boolean)?" open":"")+'><summary>导入核验榜单</summary>'+fields+
      '<button type="button" class="button" id="apply-audit-ranking">应用榜单</button><p id="audit-error" role="status"></p></details>'+
      '<label><input type="checkbox" id="ranking-anomalies" checked> 只看待复核</label>'+
      '<p class="small muted" id="ranking-summary"></p><div id="ranking-results"></div></section>';
    function update() {
      const lists = rankingText.map(parseRanking);
      const rows = api.rankingAudit(result,lists);
      const anomalies = rows.filter(row=>row.issues.length);
      const visible = el("ranking-anomalies").checked ? anomalies : rows;
      el("ranking-summary").textContent = "本批 "+rows.length+" 家集团，"+anomalies.length+" 家待复核。两份榜单分别载入 "+lists.map(list=>list.length).join("、")+" 条。";
      el("ranking-results").innerHTML = controls()+'<div id="listing"></div>';
      attachListing(visible.map(({company,issues})=>[company.name,...company.applicants,...company.lines,...issues]),indices=>
        table(["集团及报名主体","原填企业性质","榜单结果","待复核事项","原表行号"],indices.map(i=>{
          const {company,matches,issues} = visible[i];
          return [
            '<strong>'+safe(company.name)+'</strong> '+chip(company.confirmed)+'<br>'+safe([...company.applicants].join("、")),
            safe([...company.rawCategories].join("、") || "未填"),
            matches.map((entry,j)=>safe(api.rankingLabels[j])+"<br>"+(entry.row ? safe("第 "+entry.row.rank+" 名 · "+entry.row.name) :
              entry.ambiguous ? "匹配冲突" : lists[j].length ? "当前名单未匹配" : "未导入")).join("<br>"),
            issues.length ? '<span class="tag pending">待复核</span><br>'+issues.map(safe).join("<br>") : "—",
            company.lines.map(line=>button("第 "+line+" 行","audit-edit",line)).join(" ")
          ];
        }),rankingText.some(Boolean)?"当前条件下没有记录。":"请先粘贴榜单，再查看核验结果。"));
    }
    el("ranking-results").onclick = event=>{
      const edit = event.target.closest("[data-audit-edit]");
      if (edit) showEditor(Number(edit.dataset.auditEdit));
    };
    el("apply-audit-ranking").addEventListener("click",()=>{
      const next = [...content.querySelectorAll("[data-ranking]")].map(input=>input.value);
      try { next.forEach(parseRanking); } catch(error) {el("audit-error").textContent=error.message;return;}
      rankingText=next;
      el("audit-error").textContent="";
      page=0;
      update();
    });
    el("ranking-anomalies").addEventListener("change",()=>{page=0;update();});
    update();
  }
  function renderPriority(content) {
    const categories = api.options[2];
    if (!priorityInitialized) {
      categories.slice(0,3).forEach(value=>priorityCategories.add(value));
      priorityInitialized = true;
    }
    const labels = api.rankingLabels;
    const levels = api.priorityLevels;
    const fields = labels.map((label,i)=>'<label>'+safe(label)+'<textarea data-ranking="'+i+'" rows="3">'+safe(rankingText[i])+'</textarea></label>').join("");
    const filters = categories.map(label=>'<label><input type="checkbox" data-category="'+safe(label)+'"'+(priorityCategories.has(label)?" checked":"")+'> '+safe(label)+'</label>').join("");
    content.innerHTML = '<section class="panel priority"><div class="panel-heading"><div><h3>重点企业候选</h3><p class="small muted">选择企业机构性质1的序号。先按序号，再按已确认嘉宾职级排序。</p></div><button id="download-priority" type="button" class="button primary">导出重点企业 Excel</button></div>'+
      '<fieldset><legend>企业机构性质1</legend>'+filters+'</fieldset>'+
      '<details><summary>导入核验榜单</summary><p>从 Excel 复制「名次」「企业名称」两列并粘贴。可在右侧附加核实过的别名。</p>'+
      fields+'<button type="button" id="apply-ranking" class="button">应用榜单</button><p id="ranking-status" role="status"></p></details>'+
      '<p id="priority-count" class="small muted"></p><div id="priority-list"></div></section>';
    let visibleRows = [];
    el("download-priority").addEventListener("click",()=>download(false,visibleRows));
    function update() {
      try {
        const lists = rankingText.map(parseRanking);
        const rows = api.priorityGroups(result,priorityCategories,lists);
        visibleRows = rows;
        el("download-priority").disabled = !rows.length;
        el("priority-count").textContent = rows.length+" 家集团。各榜单已载入 "+lists.map(list=>list.length).join("、")+" 条。";
        el("priority-list").innerHTML = table(["企业类别","集团及参会主体","已确认嘉宾与职级","榜单核验"],rows.map(({company,categories,guests,matches})=>[
          safe(categories.join("、")), '<strong>'+safe(company.name)+'</strong><br>'+safe([...company.applicants].join("、")),
          guests.map(({values,level})=>safe(values[8])+" · "+safe(values[9])+' <span class="tag">'+levels[level-1]+'</span>').join("<br>"),
          matches.map((m,i)=>{
            const country = company.locations.size===1 ? [...company.locations][0] : "";
            const expected = i===1 ? 3 : country==="中国" ? 2 : country ? 1 : null;
            const different = m.row && expected && ![...company.categories].some(c=>Number(/^\d+/.exec(c)?.[0])===expected);
            const summary = m.row ? safe("第 "+m.row.rank+" 名 · "+m.row.name) :
              m.ambiguous ? "有多个对应企业，待核对" : lists[i].length ? "当前名单未匹配" : "未导入";
            return safe(labels[i])+"<br>"+summary+(different ? '<br><span class="tag pending">与填报类别不同，待核对</span>' : "");
          }).join("<br>")
        ]),"当前筛选条件下暂无已确认集团。");
        el("ranking-status").textContent = "";
      } catch(error) { el("ranking-status").textContent=error.message; }
    }
    el("apply-ranking").addEventListener("click",()=>{
      const next = [...content.querySelectorAll("[data-ranking]")].map(input=>input.value);
      try {next.forEach(parseRanking);} catch(error) {el("ranking-status").textContent=error.message;return;}
      rankingText=next;
      update();
    });
    content.querySelectorAll("[data-category]").forEach(input=>input.addEventListener("change",()=>{
      if (input.checked) priorityCategories.add(input.dataset.category);
      else priorityCategories.delete(input.dataset.category);
      update();
    }));
    update();
  }
  function controls() {
    return '<div class="table-controls"><input id="search" type="search" placeholder="输入关键词筛选" aria-label="筛选当前列表" value="'+safe(search)+'"><div class="pager"><button class="button" id="prev" type="button">上一页</button><span class="small" id="pagination"></span><button class="button" id="next" type="button">下一页</button></div></div>';
  }
  function attachListing(data, html) {
    function renderList() {
      const query = search.trim().toLocaleLowerCase();
      const found = data.flatMap((row,index)=>row.join(" ").toLocaleLowerCase().includes(query)?[index]:[]);
      const pages = Math.max(1,Math.ceil(found.length/pageSize));
      page = Math.min(page,pages-1);
      el("listing").innerHTML = html(found.slice(page*pageSize,(page+1)*pageSize));
      el("pagination").textContent = found.length+" 项 · "+(page+1)+"/"+pages;
      el("prev").disabled = page === 0;
      el("next").disabled = page+1 === pages;
    }
    el("search").addEventListener("input",event=>{search=event.target.value;page=0;renderList();});
    el("prev").addEventListener("click",()=>{page--;renderList();});
    el("next").addEventListener("click",()=>{page++;renderList();});
    renderList();
  }
  function showEditor(line) {
    const record = workbook.records.find(r=>r.line===line);
    if (!record) return;
    const previous = edits.get(line) ?? {};
    const row = result.rows.find(r=>r.lines.includes(line));
    const old = field=>previous[field] ?? record.values[field] ?? "";
    const fields = [1,2,3,4,5,6,7,8,9,10,13];
    const notices = result.notices.filter(n=>n.line===line);
    const choices = field=>field===13 ? api.inviters : field===3 ? result.countryOptions : field>=4 && field<=7 ? api.options[field-3] : null;
    const fieldHtml = fields.map(field=>{
      const v = field === 13 && !Object.hasOwn(previous,13) ? row?.values[13] ?? record.section ?? old(field) : old(field);
      const options = choices(field);
      const candidates = [...new Set([...(v?[v]:[]),...(options??[])])];
      const control = options ? '<select data-field="'+field+'"><option value="">（空）</option>'+candidates.map(c=>'<option value="'+safe(c)+'"'+(c===v?' selected':'')+'>'+safe(c)+'</option>').join("")+'</select>' :
        '<input data-field="'+field+'" value="'+safe(v)+'">';
      return '<label>'+safe(api.title(field))+control+'</label>';
    }).join("");
    const allLeads = row ? [...row.sources] : [];
    const currentLead = leads.get(row?.lines[0]) ?? "";
    el("editor-fields").innerHTML = '<h3>复核原表第 '+line+' 行</h3><p class="muted">'+safe(notices.map(n=>n.label).join("；") || "检查并修正此行字段。")+'</p><div class="edit-grid">'+fieldHtml+
      (allLeads.length>1?'<label class="full">排座表牵头邀请单位<select id="lead"><option value="">请选择</option>'+allLeads.map(v=>'<option value="'+safe(v)+'"'+(currentLead===v?' selected':'')+'>'+safe(v)+'</option>').join("")+'</select></label>':"")+
      '</div>'+(previous.nationalityVerified || notices.some(n=>n.label.startsWith("嘉宾姓名与国籍需核对")) ? '<label class="check"><input type="checkbox" id="nationality-verified"'+(previous.nationalityVerified?' checked':'')+'> 已核对嘉宾姓名和国籍</label>' : '')+'<label class="check"><input type="checkbox" id="exclude"'+(previous.skip?' checked':'')+'> 排除这条明细，保留邀请来源</label>';
    const syncFG = () => {
      const e = el("editor-fields").querySelector('[data-field="4"]').value;
      for (const [field,other] of [[5,"招商合作机构"],[6,"意向投资企业"]]) {
        const input = el("editor-fields").querySelector('[data-field="'+field+'"]');
        if (e===other) {input.value="";input.disabled=true;} else input.disabled=false;
      }
    };
    el("editor-fields").querySelector('[data-field="4"]').addEventListener("change",syncFG);
    syncFG();
    saveDialog = () => {
      const next = {...previous,skip:el("exclude").checked};
      el("editor-fields").querySelectorAll("[data-field]").forEach(input=>{
        const field = Number(input.dataset.field);
        if (input.value !== old(field)) next[field]=input.value;
      });
      if (el("lead")) {
        const lead = el("lead").value;
        if (lead) leads.set(row.lines[0],lead); else leads.delete(row.lines[0]);
      }
      next.nationalityVerified = !!el("nationality-verified")?.checked &&
        (!previous.nationalityVerified || ((next[8] ?? old(8)) === old(8) && (next[10] ?? old(10)) === old(10)));
      edits.set(line,next);
      return true;
    };
    el("dialog").showModal();
  }
  function showGroup(name) {
    if (!name) return;
    const otherNames = [...new Set([...name.suggestions,...[...result.groups.values()].map(group=>group.name)])];
    const related = name.suggestions.length ? '<p class="muted">相似集团 '+safe(name.suggestions.join("、"))+'</p>' : "";
    el("editor-fields").innerHTML = '<h3>统一集团名称</h3><p class="muted">原名称 '+safe(name.original)+'　'+safe(name.location)+'</p>'+related+'<div class="edit-grid"><label class="full">规范集团名称<input id="group-name" list="group-list" required value="'+safe(name.group)+'"><datalist id="group-list">'+otherNames.map(v=>'<option value="'+safe(v)+'"></option>').join("")+'</datalist></label></div><p class="small muted">此名称和地区组合的全部明细将同步更新，原始名牌文本保留。</p>'+(groupRules.has(name.id)?'<label class="check"><input type="checkbox" id="clear-group"> 清除此名称的自定义映射</label>':"");
    saveDialog = () => {
      const value = el("group-name").value.trim();
      if (!value) return false;
      if (el("clear-group")?.checked) groupRules.delete(name.id); else groupRules.set(name.id,value);
      storeGroupRules();
      return true;
    };
    el("dialog").showModal();
  }
  el("cancel").addEventListener("click",()=>el("dialog").close());
  el("editor").addEventListener("submit",event=>{
    event.preventDefault();
    if (saveDialog?.()) {el("dialog").close();refresh();}
  });
  function clearDownloadLink() {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = undefined;
    el("download-ready").hidden = true;
  }
  async function download(confirmedOnly = false, priorityRows = null) {
    if (!result || busy) return;
    if (!el("date").value) {status("请选择数据日期后下载。",true);el("date").focus();return;}
    busy = true;
    el("download").disabled=true;
    clearDownloadLink();
    status(priorityRows?"正在生成重点企业 Excel…":confirmedOnly?"正在生成确认企业核验 Excel…":"正在生成整理 Excel…");
    const date=el("date").value;
    const draft=result.notices.length>0;
    try {
      const data=priorityRows ? await api.exportPriority(priorityRows,date) : await api.exportExcel(result,date,confirmedOnly);
      downloadUrl=URL.createObjectURL(new Blob([data],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
      const a=el("download-ready");
      a.href=downloadUrl;
      a.download=(priorityRows?"重点企业候选_":confirmedOnly?"确认参会集团_":"主会场嘉宾整理_")+date+(!priorityRows && !confirmedOnly && draft?"_含待复核":"")+".xlsx";
      a.hidden=false;
      a.click();
      status(priorityRows?"已生成重点企业 Excel。如下载未开始，请点「手动保存已生成文件」。":confirmedOnly?"已生成确认企业核验 Excel。如下载未开始，请点「手动保存已生成文件」。":draft?"已生成整理稿。请查看工作簿中的「待复核」和「跨单位重复邀请」。":"已生成整理后的 Excel。");
    } catch {
      status("生成 Excel 失败，请重试。",true);
    } finally {busy=false;el("download").disabled=false;}
  }
  el("download").addEventListener("click",()=>download());
})();
