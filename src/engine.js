globalThis.createWorkbench = function (rules) {
  "use strict";
  const { options, industryAliases, inviters, headers, template, columnWidths, companyAliases = {} } = rules;
  const root = globalThis;
  const clean = value => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
  const key = value => clean(value).replace(/\s/g, "").toLowerCase();
  const reviewRules = new Map(RankingData.rules.flatMap(rule => rule.names.map(name => [key(name),rule])));
  const valid = value => !!clean(value) && !/^(待定|待确认|暂未确定|待补充|待填|无|暂无|未定|未知|不详|待提供|不参加|未确认|tbd|n\/?a|null|unknown|[-—/]+)$/i.test(clean(value));
  const confirmed = row => valid(row[8]) && valid(row[9]);
  const guestComplete = row => confirmed(row) && valid(row[10]);
  const core = name => key(name).replace(/(?:有限责任公司|股份有限公司|集团有限公司|有限公司|集团公司|集团|公司)$/g, "");
  const substance = value => key(value).replace(/^\d+[.、:．)]+/, "");
  const byOption = options.map(column => new Map(column.map(value => [substance(value), value])));
  const mainland = new Set("北京 上海 天津 重庆 河北 山西 辽宁 吉林 黑龙江 江苏 浙江 安徽 福建 江西 山东 河南 湖北 湖南 广东 海南 四川 贵州 云南 陕西 甘肃 青海 新疆 广西 宁夏 内蒙古 西藏 深圳 广州 成都 佛山 武汉 宁波 西安 长沙 苏州 杭州 惠州 郑州 东莞 厦门 南京 哈尔滨 青岛 唐山 无锡 通化 合肥 济南 福州 珠海 中山 沈阳 南宁 南昌 太原 长春 海口 昆明 兰州 贵阳 南通".split(" "));
  const countryAliases = new Map(Object.entries({
    "香港":"中国香港", "中国(香港)":"中国香港", "中国香港特别行政区":"中国香港",
    "澳门":"中国澳门", "中国(澳门)":"中国澳门", "中国澳门特别行政区":"中国澳门",
    "台湾":"中国台湾", "中国(台湾)":"中国台湾", "台湾省":"中国台湾",
    "迪拜":"阿联酋", "中国大陆":"中国", "中国内地":"中国", "中华人民共和国":"中国",
    "UK":"英国", "USA":"美国"
  }).map(([k,v]) => [key(k),v]));
  const defaultCountries = [...new Set([...options[0], "中国澳门"])];
  const countryDirectory = new Map();
  const chineseRegion = new Intl.DisplayNames(["zh-Hans"],{type:"region",fallback:"none"});
  const englishRegion = new Intl.DisplayNames(["en"],{type:"region",fallback:"none"});
  const traditionalRegion = new Intl.DisplayNames(["zh-Hant"],{type:"region",fallback:"none"});
  const configuredCountries = new Map(defaultCountries.map(value=>[key(value),value]));
  const regionOverrides = { HK:"中国香港", MO:"中国澳门", TW:"中国台湾" };
  // ISO alpha-2 regions from Unicode CLDR territory containment and code mappings.
  const regionCodes = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");
  for (const code of regionCodes) {
    const simplified = chineseRegion.of(code);
    if (!simplified) continue;
    const canonical = regionOverrides[code] ?? configuredCountries.get(key(simplified)) ?? simplified;
    for (const value of [code,simplified,englishRegion.of(code),traditionalRegion.of(code)]) {
      if (value) countryDirectory.set(key(value),canonical);
    }
  }
  for (const [name,value] of configuredCountries) countryDirectory.set(name,value);
  const countryPrefixes = [...new Set(countryDirectory.values())].sort((a,b)=>b.length-a.length);
  const domesticKinds = new Set(["世界500强(国内企业)", "中国500强", "中央企业", "国有企业"]);
  const foreignKinds = new Set(["世界500强(外企)", "外资企业"]);
  const knownGroups = new Map(Object.entries(companyAliases).map(([k,v]) => [core(k),v]));
  const fieldKeys = headers.map(key);
  const title = field => ["企业性质", "合作机构性质"][field - 5] ?? headers[field];
  const xml = value => String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"})[c]);
  const local = name => name.split(":").at(-1);
  const node = (parent, name) => parent?.children.find(child => child.name === name);
  const children = (parent, name) => parent?.children.filter(child => child.name === name) ?? [];
  function parseXml(source) {
    const document = { children: [] };
    const stack = [document];
    const parser = root.sax.parser(true, {});
    parser.onopentag = tag => {
      const child = { name: local(tag.name), attrs: tag.attributes, children: [], text: "" };
      stack.at(-1).children.push(child);
      stack.push(child);
    };
    parser.onclosetag = () => stack.pop();
    parser.ontext = parser.oncdata = value => { stack.at(-1).text += value; };
    parser.write(source).close();
    return document.children[0];
  }
  const col = letters => [...letters].reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  function letters(index) {
    const char = String.fromCharCode(65 + index % 26);
    return index < 26 ? char : letters(Math.floor(index / 26) - 1) + char;
  }
  const coordinate = ref => {
    const match = /^([A-Z]+)(\d+)$/.exec(ref);
    return match ? [Number(match[2]), col(match[1])] : null;
  };
  const richText = n => (node(n,"t")?.text ?? "") + children(n,"r").map(r => node(r,"t")?.text ?? "").join("");
  function worksheet(source, strings) {
    const parsed = parseXml(source);
    const rows = new Map();
    for (const item of children(node(parsed, "sheetData"), "row")) {
      const row = new Map();
      for (const cell of children(item, "c")) {
        const pos = coordinate(cell.attrs.r);
        if (!pos) continue;
        const v = node(cell, "v")?.text ?? "";
        const value = cell.attrs.t === "s" ? strings[Number(v)] : cell.attrs.t === "inlineStr" ? richText(node(cell,"is")) : cell.attrs.t === "b" ? (v === "1" ? "是" : "否") : cell.attrs.t === "e" ? "" : v;
        if (String(value ?? "").trim()) row.set(pos[1], value);
      }
      if (row.size) rows.set(Number(item.attrs.r), row);
    }
    return { rows, merges: children(node(parsed, "mergeCells"), "mergeCell").map(n => n.attrs.ref.split(":").map(coordinate)).filter(m => m.length === 2 && m.every(Boolean)) };
  }
  function matchHeaders(row) {
    const result = new Map();
    let context = -1;
    for (const [index, value] of row) {
      const normalized = key(value).replace(/\(在下拉选项选填\)$/,"");
      let field = fieldKeys.indexOf(normalized);
      if (normalized === "参会嘉宾国錐") field = 10;
      if (normalized.startsWith("备注")) field = 21;
      if (normalized.startsWith("企业机构性质1")) field = 5;
      if (normalized.startsWith("企业机构性质2")) field = 6;
      if (normalized === "联系方式" || normalized === "联系电话" || normalized === "手机号") field = context === 14 || context === 13 ? 15 : 12;
      if (normalized === "企业联系方式" || normalized === "企业联系人电话") field = 12;
      if (normalized === "邀请单位联系方式" || normalized === "邀请单位联系人电话") field = 15;
      if (field >= 0) {
        result.set(field, index);
        if (field !== 12 && field !== 15) context = field;
      }
    }
    return result.has(1) && result.has(8) && result.has(9) ? result : null;
  }
  async function readExcel(buffer) {
    const zip = await root.JSZip.loadAsync(buffer);
    const get = async path => zip.file(path)?.async("string");
    const bookText = await get("xl/workbook.xml");
    const linksText = await get("xl/_rels/workbook.xml.rels");
    if (!bookText || !linksText) throw new Error("请选择 Excel 的 .xlsx 文件。");
    const book = parseXml(bookText);
    const links = new Map(children(parseXml(linksText), "Relationship").map(n => [n.attrs.Id, n.attrs.Target]));
    const stringText = await get("xl/sharedStrings.xml");
    const strings = stringText ? children(parseXml(stringText), "si").map(richText) : [];
    const sheets = children(node(book, "sheets"), "sheet");
    const ordered = [...sheets.filter(s => s.attrs.name === "主会场"), ...sheets.filter(s => s.attrs.name !== "主会场")];
    for (const sheet of ordered) {
      const target = links.get(sheet.attrs["r:id"]);
      if (!target) continue;
      const content = await get(target.startsWith("/") ? target.slice(1) : "xl/" + target);
      if (!content) continue;
      const { rows, merges } = worksheet(content, strings);
      if (![...rows.values()].some(matchHeaders)) continue;
      const horizontal = new Set(merges.filter(([[a,b],[c,d]]) => a === c && b === 0 && d >= 4).map(m => m[0][0]));
      const vertical = new Map();
      for (const [[first, start], [last, end]] of merges) {
        if (first >= last || start !== end || last - first > 10000) continue;
        const value = rows.get(first)?.get(start);
        if (value === undefined) continue;
        for (let n = first + 1; n <= last; n++) {
          if (!vertical.has(n)) vertical.set(n, new Map());
          vertical.get(n).set(start, value);
        }
      }
      let header, section = "", excludedExamples = 0;
      const records = [];
      for (const [line, cells] of [...rows].sort(([a],[b]) => a - b)) {
        const found = matchHeaders(cells);
        if (found) { header = found; continue; }
        const heading = clean(cells.get(0));
        if (horizontal.has(line) || (cells.size === 1 && inviters.includes(heading))) {
          if (heading && !/^(备注|说明)|名单$/.test(heading)) section = heading;
          continue;
        }
        if (!header) continue;
        const serial = header.get(0);
        if (key(cells.get(serial) ?? vertical.get(line)?.get(serial)) === "例") {
          excludedExamples++;
          continue;
        }
        if (![...header].some(([field, index]) => field > 0 && cells.has(index))) continue;
        const values = headers.map((_, field) => {
          const index = header.get(field);
          const direct = cells.get(index);
          return direct ?? (field === 8 ? "" : vertical.get(line)?.get(index) ?? "");
        });
        if (!values[1] && !values[8] && !values[9] && !values[2] && !values[11]) continue;
        records.push({ line, values, section });
      }
      if (!records.length) throw new Error("已找到表头，表中没有可处理的嘉宾或单位明细。");
      return { name: sheet.attrs.name, records, excludedExamples };
    }
    throw new Error("未找到包含参会单位名称、嘉宾姓名和嘉宾职务的工作表。");
  }
  function country(value) {
    const raw = key(value);
    if (countryAliases.has(raw)) return countryAliases.get(raw);
    const exact = countryDirectory.get(raw) ?? countryDirectory.get(raw.replace(/(?:共和国|共和國|王国|王國)$/,""));
    if (exact) return exact;
    const place = raw.replace(/^中国[(/、-]?/, "").replace(/\)$/, "").replace(/(省|市)$/, "");
    if (mainland.has(place) || /^中国(?:大陆|内地)/.test(raw) || /^中国[\u4e00-\u9fff]+(?:市|省)$/.test(raw)) return "中国";
    if (/^中国/.test(raw) && [...mainland].some(city => place.startsWith(city))) return "中国";
    return "";
  }
  function nameCountry(name) {
    const label = clean(name);
    return countryPrefixes.find(c=>label.startsWith(c)) ?? "";
  }
  function formatGroup(name, location, kind) {
    if (!name || kind === "招商合作机构" || !location || location === "中国") return name;
    const prefixed = name.startsWith(location) ? name : location + name;
    return /(?:集团|公司)(?:[（(][^）)]+[）)])?$/.test(prefixed) ? prefixed : prefixed + "公司";
  }
  function matchRegionalCompanies(records) {
    const parents = new Map();
    const baseName = (name, location) => {
      const normalized = key(name);
      return normalized.startsWith(key(location)) ? normalized.slice(key(location).length) : normalized;
    };
    const enterprise = record => record.kind === "意向投资企业" && record.normalizedLocation && !record.override.skip;
    for (const record of records) {
      if (!enterprise(record)) continue;
      const match = /^(.*)集团(?:股份有限公司|有限责任公司|有限公司|公司)?$/.exec(baseName(record.selectedName,record.normalizedLocation));
      if (!match?.[1]) continue;
      const id = JSON.stringify([record.normalizedLocation,match[1]]);
      if (!parents.has(id)) parents.set(id,new Set());
      parents.get(id).add(record.selectedName);
    }
    for (const record of records) {
      if (!enterprise(record) || record.approvedGroup || record.known) continue;
      const match = /^(.+)\(([^()]+)\)$/.exec(core(baseName(record.selectedName,record.normalizedLocation)));
      if (!match || !(country(match[2]) || ["中国区","大湾区","亚太"].includes(match[2]))) continue;
      const candidates = parents.get(JSON.stringify([record.normalizedLocation,match[1]]));
      if (candidates?.size === 1) record.selectedName = [...candidates][0];
    }
  }
  function process(records, edits = new Map(), groupRules = new Map(), selections = new Map()) {
    const notices = [];
    const rows = [];
    const lookup = new Map();
    const exact = new Map();
    const active = [];
    const groupInputs = new Map();
    const add = (line, label, value, field = -1) => notices.push({line,label,value,field});
    const aliasKey = (name, location) => JSON.stringify([key(name), location]);
    const prepared = records.map(record => {
      const override = edits.get(record.line) ?? {};
      const values = record.values.map((value, field) => override[field] ?? value);
      const original = clean(values[1]);
      const location = country(values[3]);
      const approvedGroup = groupRules.get(aliasKey(original, location));
      const known = knownGroups.get(core(original));
      const review = reviewRules.get(key(original));
      const selectedName = approvedGroup ?? review?.group ?? known ?? original;
      const prefixed = nameCountry(selectedName);
      const explicitCountry = prefixed === "中国" && location !== "中国" ? "" : prefixed;
      const normalizedLocation = explicitCountry && (known || approvedGroup)
        ? explicitCountry : location || review?.country || "";
      const kind = byOption[1].get(substance(values[4])) ?? "";
      return { record, override, values, original, location, explicitCountry, normalizedLocation, kind, selectedName, known, approvedGroup, review };
    });
    matchRegionalCompanies(prepared);
    const naming = new Map();
    for (const r of prepared) {
      if (!r.selectedName || !r.normalizedLocation) continue;
      const unprefixed = r.selectedName.startsWith(r.normalizedLocation) ? r.selectedName.slice(r.normalizedLocation.length) : r.selectedName;
      const id = JSON.stringify([r.normalizedLocation, core(unprefixed) || key(r.selectedName)]);
      const proposed = formatGroup(r.selectedName, r.normalizedLocation, r.kind);
      r.groupId = id;
      const best = naming.get(id);
      if (!best || r.approvedGroup || (!best.approved && /集团/.test(proposed) && !/集团/.test(best.name))) {
        naming.set(id, {name:proposed, approved:!!r.approvedGroup});
      }
    }
    const guestIdentity = ({groupId,values}) => JSON.stringify([groupId,key(values[8]),key(values[9])]);
    const guestNationalities = new Map();
    for (const r of prepared) {
      if (r.override.skip || !r.groupId || !guestComplete(r.values)) continue;
      const id = guestIdentity(r);
      if (!guestNationalities.has(id)) guestNationalities.set(id,new Set());
      guestNationalities.get(id).add(country(r.values[10]) || key(r.values[10]));
    }
    let filledNationalities = 0;
    for (const r of prepared) {
      const { record, values, original, location, explicitCountry, normalizedLocation, kind, selectedName } = r;
      const { line } = record;
      const department = clean(record.values[13]);
      const groupHeading = clean(record.section);
      const primary = Object.hasOwn(r.override,13) ? clean(r.override[13]) : groupHeading || department;
      const sources = primary ? [primary] : [];
      if (r.override.skip) {
        if (original) active.push({ line, name: naming.get(r.groupId)?.name ?? selectedName, values, sources, department, excluded: true });
        continue;
      }
      const group = naming.get(r.groupId)?.name ?? selectedName;
      if (original) {
        const id = aliasKey(original, location);
        if (!groupInputs.has(id)) groupInputs.set(id,{id,original,location,group,line});
      }
      if (!group) add(line, "缺少参会单位名称", "", 1);
      if (!normalizedLocation) add(line, "国别（地区）待确认", values[3], 3);
      if (explicitCountry && location && explicitCountry !== location) add(line, "集团名称与国别不一致", values[3], 3);
      if (!kind) add(line, "参会单位类型待确认", values[4], 4);
      const originalCategory = byOption[2].get(substance(values[5])) ?? (/^外资$/.test(clean(values[5])) ? "4.外资企业" : "");
      const f = !Object.hasOwn(r.override,5) && r.review?.category
        ? options[2].find(option => categorySequence(option) === r.review.category) ?? originalCategory
        : originalCategory;
      if (kind === "意向投资企业" && r.review?.pending) add(line, "榜单人工复核待确认", r.review.note, 5);
      const g = byOption[3].get(substance(values[6])) ?? "";
      if (values[5] && values[6]) add(line, "F／G 同时填写，确认后清空不适用列", values[5] + " / " + values[6], kind === "招商合作机构" ? 5 : 6);
      if (kind === "意向投资企业" && !f) add(line, "企业机构性质1待确认", values[5], 5);
      if (kind === "招商合作机构" && !g) add(line, "企业机构性质2待确认", values[6], 6);
      if (kind === "意向投资企业" && values[6] && !values[5]) add(line, "意向投资企业应填写 F 列", values[6], 6);
      if (kind === "招商合作机构" && values[5] && !values[6]) add(line, "招商合作机构应填写 G 列", values[5], 5);
      const rawIndustry = clean(values[7]);
      const industryAlias = industryAliases[rawIndustry] ?? ({"非盈利机构":"非营利机构","新一代信息技术":"新一代信息技术产业","新材料":"新材料产业","新能源":"新能源产业","高端装备":"高端装备产业"})[rawIndustry];
      const industry = byOption[4].get(substance(rawIndustry)) ?? byOption[4].get(substance(industryAlias)) ?? "";
      if (!industry) add(line, "行业领域待确认", values[7], 7);
      if (!primary || !inviters.includes(primary)) add(line, "邀请单位待确认", primary, 13);
      if (groupHeading && inviters.includes(department) && groupHeading !== department && !Object.hasOwn(r.override, 13)) {
        add(line, "分组与填报邀请单位不同", groupHeading + " / " + department, 13);
      }
      if (kind === "意向投资企业" && ((normalizedLocation === "中国" && foreignKinds.has(substance(f))) || (normalizedLocation && normalizedLocation !== "中国" && domesticKinds.has(substance(f))))) {
        add(line, "机构性质与集团国别不一致", f, 5);
      }
      if (valid(values[8]) !== valid(values[9])) add(line, "姓名或职务缺一项，暂列待确认", valid(values[8]) ? values[9] : values[8], valid(values[8]) ? 9 : 8);
      let nationality = /^(china|chinese|prc|中國)$/i.test(clean(values[10])) ? "中国" : clean(values[10]).replace(/^中國/, "中国");
      const evidence = r.groupId ? guestNationalities.get(guestIdentity(r)) : undefined;
      if (confirmed(values) && evidence?.size > 1) add(line, "同一嘉宾国籍填报冲突", [...evidence].join(" / "), 10);
      if (confirmed(values) && !valid(nationality)) {
        const inferred = evidence?.size === 1 ? country([...evidence][0]) : "";
        if (inferred && !Object.hasOwn(r.override,10)) {
          nationality = inferred;
          filledNationalities++;
        } else if (!(evidence?.size > 1)) add(line, "嘉宾国籍缺失，嘉宾资料待补齐", values[10], 10);
      }
      const latinName = /^[\p{Script=Latin}][\p{Script=Latin}.'’ -]*[ .-][\p{Script=Latin}][\p{Script=Latin}.'’ -]*$/u.test(clean(values[8]));
      const nameWithMiddleDot = /\p{Script=Han}[·・‧]\p{Script=Han}/u.test(clean(values[8]).replace(/\s/g,""));
      if (guestComplete(values) && nationality === "中国" && (latinName || nameWithMiddleDot) && !r.override.nationalityVerified) {
        add(line, "嘉宾姓名与国籍需核对（姓名写法提示）", values[8] + " / " + values[10], 10);
      }
      const normalized = [...values];
      Object.assign(normalized, {0:"",1:group,3:normalizedLocation,4:kind,5:kind === "意向投资企业" ? f : "",6:kind === "招商合作机构" ? g : "",7:industry,10:nationality,13:primary});
      active.push({ line, name:group, original, values:normalized, sources, department, excluded:false });
      const item = { values:normalized, sources:new Set(sources), lines:[line] };
      const fields = normalized.slice(1).map((value,index) => index + 1 === 2 ? value : clean(value));
      const duplicateKey = JSON.stringify([fields, ...(!group || !valid(normalized[8]) ? [primary] : [])]);
      const same = exact.get(duplicateKey);
      if (same) {
        same.lines.push(line);
        sources.forEach(source => same.sources.add(source));
        continue;
      }
      exact.set(duplicateKey,item);
      if (group && valid(normalized[8])) {
        const id = JSON.stringify([key(group),key(normalized[8])]);
        const prior = lookup.get(id) ?? [];
        if (prior.length) {
          const existing = prior[0];
          if (prior.length === 1 && compatible(existing.values, normalized)) {
            existing.values = existing.values.map((value, field) => field >= 13 && field <= 15 ? value : (value || normalized[field]));
            existing.lines.push(line);
            sources.forEach(source => existing.sources.add(source));
            exact.set(duplicateKey,existing);
            continue;
          }
          add(line, "同集团同名嘉宾资料不同，核对后合并或保留", group + " / " + normalized[8], 8);
        }
        prior.push(item);
        lookup.set(id,prior);
      }
      rows.push(item);
    }
    const sourceByLine = new Map(active.map(record => [record.line,record]));
    rows.forEach((row,index) => {
      row.values[0] = String(index + 1);
      const choice = selections.get(row.lines[0]);
      if (choice && row.sources.has(choice)) {
        const origin = row.lines.map(line => sourceByLine.get(line)).find(r => r?.values[13] === choice);
        if (row.values[13] !== choice) {
          row.values[14] = origin?.values[14] ?? "";
          row.values[15] = origin?.values[15] ?? "";
        }
        row.values[13] = choice;
      } else if (row.sources.size > 1) {
        add(row.lines[0], "多来源合并，需确认牵头邀请单位", [...row.sources].join("、"), 13);
      }
    });
    const groups = new Map();
    const byUnit = new Map(inviters.map(inviter=>[inviter,new Map()]));
    const confirmedEnterprises = new Map();
    const rankingCompanies = new Map();
    const preparedByLine = new Map(prepared.map(input=>[input.record.line,input]));
    for (const record of active) {
      if (!record.name) continue;
      const id = key(record.name);
      if (!groups.has(id)) groups.set(id,{ name:record.name, units:new Map(), statuses:[], enterprise:false });
      const g = groups.get(id);
      const isConfirmed = !record.excluded && confirmed(record.values);
      const enterprise = record.values[4] === "意向投资企业";
      const input = preparedByLine.get(record.line);
      if (!record.excluded && record.values[4] !== "招商合作机构") {
        if (!rankingCompanies.has(id)) rankingCompanies.set(id,{name:record.name,locations:new Set(),applicants:new Set(),
          categories:new Set(),rawCategories:new Set(),lines:[],verifiedGroup:false,confirmed:false});
        const item = rankingCompanies.get(id);
        if (record.values[3]) item.locations.add(record.values[3]);
        if (input.original) item.applicants.add(input.original);
        if (record.values[5]) item.categories.add(record.values[5]);
        if (input.values[5]) item.rawCategories.add(input.values[5]);
        item.lines.push(record.line);
        item.verifiedGroup ||= !!(input.known || input.approvedGroup);
        item.confirmed ||= isConfirmed && enterprise;
      }
      if (enterprise && !record.excluded) g.enterprise = true;
      if (isConfirmed) g.statuses.push([record.values[3],record.values[4],substance(record.values[5])]);
      if (isConfirmed && enterprise) {
        if (!confirmedEnterprises.has(id)) confirmedEnterprises.set(id, { name:record.name, locations:new Set(), guests:new Map(), units:new Set(), categories:new Set(), applicants:new Set(), verifiedGroup:false });
        const company = confirmedEnterprises.get(id);
        if (input?.original) company.applicants.add(input.original);
        if (input?.known || input?.approvedGroup) company.verifiedGroup = true;
        if (record.values[5]) company.categories.add(record.values[5]);
        if (record.values[3]) company.locations.add(record.values[3]);
        const personKey = JSON.stringify([key(record.values[8]),key(record.values[9])]);
        if (!company.guests.has(personKey) || !valid(company.guests.get(personKey)[10])) company.guests.set(personKey,record.values);
        record.sources.forEach(unit=>company.units.add(unit));
      }
      for (const inviter of record.sources) {
        if (enterprise && !record.excluded && byUnit.has(inviter)) {
          const invited = byUnit.get(inviter);
          invited.set(id, isConfirmed || invited.get(id) === true);
        }
        if (!g.units.has(inviter)) g.units.set(inviter,[]);
        const unit = g.units.get(inviter);
        const detail = {guest:clean(record.values[8]), position:clean(record.values[9]), confirmed:isConfirmed, complete:isConfirmed && guestComplete(record.values), line:record.line, department:record.department};
        if (!unit.some(d => d.guest === detail.guest && d.position === detail.position && d.confirmed === detail.confirmed && d.department === detail.department)) unit.push(detail);
      }
    }
    const variants = new Map();
    for (const item of groupInputs.values()) {
      const label = item.group;
      const prefix = nameCountry(label);
      const base = core(prefix ? label.slice(prefix.length) : label).replace(/\((?:中国|中国区|亚太|香港|深圳|上海|北京|广州)\)$/, "");
      if (base.length < 4) continue;
      if (!variants.has(base)) variants.set(base,new Set());
      variants.get(base).add(label);
      item.variant = base;
    }
    for (const item of groupInputs.values()) {
      item.suggestions = [...(variants.get(item.variant) ?? [])].filter(name=>name!==item.group);
    }
    const counts = { confirmed:0, domestic:0, foreign:0, partners:0, pending:0, countries:new Map() };
    for (const g of groups.values()) {
      if (!g.statuses.length) continue;
      counts.confirmed++;
      const types = new Set(g.statuses.map(([,kind]) => kind));
      const locations = new Set(g.statuses.map(([location]) => location));
      const clash = g.statuses.some(([location,,nature]) => (location === "中国" && foreignKinds.has(nature)) || (location && location !== "中国" && domesticKinds.has(nature)));
      if (types.size === 1 && types.has("招商合作机构")) counts.partners++;
      else if (types.size !== 1 || !types.has("意向投资企业") || locations.size !== 1 || locations.has("") || clash) counts.pending++;
      else if (locations.has("中国")) counts.domestic++;
      else {
        counts.foreign++;
        const location = [...locations][0];
        counts.countries.set(location,(counts.countries.get(location) ?? 0) + 1);
      }
    }
    const units = [...byUnit].map(([name,invited])=>{
      const confirmed = [...invited.values()].filter(Boolean).length;
      return {name, confirmed, pending:invited.size-confirmed};
    });
    const countryOptions = [...new Set([...defaultCountries,...prepared.flatMap(r=>r.override.skip ? [] : [r.location,r.normalizedLocation]).filter(Boolean)])];
    const invited = new Set();
    const feedback = new Set();
    const invitationsByUnit = new Map();
    for (const record of active) {
      if (record.excluded || !valid(record.name)) continue;
      const group = key(record.name);
      invited.add(group);
      for (const unit of record.sources) {
        if (!inviters.includes(unit)) continue;
        if (!invitationsByUnit.has(unit)) invitationsByUnit.set(unit,new Set());
        invitationsByUnit.get(unit).add(group);
      }
      if (record.values[4]==="意向投资企业" && confirmed(record.values)) {
        feedback.add(JSON.stringify([group,key(record.original),record.values[13]]));
      }
    }
    const invitationStats = {invited:invited.size,feedback:feedback.size,
      units:[...invitationsByUnit].map(([name,items])=>({name,count:items.size}))
        .sort((a,b)=>b.count-a.count || a.name.localeCompare(b.name,"zh"))};
    return { rows, notices, filledNationalities, counts, groups, groupInputs, units, countryOptions, invitationStats, rankingCompanies:[...rankingCompanies.values()], confirmedEnterprises:[...confirmedEnterprises.values()], duplicates:[...groups.values()].filter(g => g.enterprise && g.units.size > 1), removed:active.filter(r=>!r.excluded).length - rows.length };
  }
  function compatible(a,b) {
    return a.every((v,i) => i === 0 || (i >= 13 && i <= 15 && a[13] !== b[13]) || !v || !b[i] || (i === 2 ? v === b[i] : clean(v) === clean(b[i])));
  }
  const baseOptions = [defaultCountries,...options.slice(1)];
  const mainXml = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const relationshipXml = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  function rowXml(values, number, style = "") {
    return '<row r="' + number + '">' + values.map((value,index) =>
      value === "" || value == null ? "" : typeof value === "number" ?
      '<c r="' + letters(index) + number + '"><v>' + value + '</v></c>' :
      '<c r="' + letters(index) + number + '"' + style + ' t="inlineStr"><is><t xml:space="preserve">' + xml(value) + '</t></is></c>'
    ).join("") + '</row>';
  }
  function simpleSheet(data, widths) {
    return '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="' + mainXml + '"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>' +
      widths.map((w,i) => '<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join("") +
      "</cols><sheetData>" + data.map((row,index) => rowXml(row,index+1)).join("") + "</sheetData></worksheet>";
  }
  function createBlankWorkbook(widths = columnWidths) {
    const zip = new root.JSZip();
    const declaration = '<?xml version="1.0" encoding="UTF-8"?>';
    const spreadsheetType = "application/vnd.openxmlformats-officedocument.spreadsheetml.";
    const rel = (id,type,target) => '<Relationship Id="'+id+'" Type="'+relationshipXml+'/'+type+'" Target="'+target+'"/>';
    const relationships = content => '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+content+'</Relationships>';
    const put = (path,content) => zip.file(path,declaration+content);
    put("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+
      '<Override PartName="/xl/workbook.xml" ContentType="'+spreadsheetType+'sheet.main+xml"/>'+
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="'+spreadsheetType+'worksheet+xml"/>'+
      '<Override PartName="/xl/styles.xml" ContentType="'+spreadsheetType+'styles+xml"/>'+
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>');
    put("_rels/.rels",relationships(rel("rId1","officeDocument","xl/workbook.xml")+rel("rId2","extended-properties","docProps/app.xml")));
    put("xl/_rels/workbook.xml.rels",relationships(rel("rId1","worksheet","worksheets/sheet1.xml")+rel("rId2","styles","styles.xml")));
    put("xl/workbook.xml",'<workbook xmlns="'+mainXml+'" xmlns:r="'+relationshipXml+'"><bookViews><workbookView/></bookViews><sheets><sheet name="form" sheetId="1" r:id="rId1"/></sheets></workbook>');
    put("xl/worksheets/sheet1.xml",'<worksheet xmlns="'+mainXml+'"><dimension ref="A1:V1"/><cols>'+
      widths.map((width,index)=>'<col min="'+(index+1)+'" max="'+(index+1)+'" width="'+width+'" customWidth="1"/>').join("")+
      "</cols><sheetData>"+rowXml(headers,1,' s="1"')+'</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>');
    put("xl/styles.xml",'<styleSheet xmlns="'+mainXml+'">'+
      '<fonts count="2"><font><sz val="11"/><name val="等线"/></font><font><b/><sz val="11"/><name val="等线"/></font></fonts>'+
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F1"/></patternFill></fill></fills>'+
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>'+
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
    put("docProps/app.xml",'<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'+
      '<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs>'+
      '<TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>form</vt:lpstr></vt:vector></TitlesOfParts></Properties>');
    return zip;
  }
  async function exportExcel(result, date, confirmedOnly = false) {
    const choiceColumns = [result.countryOptions,...baseOptions.slice(1)];
    const zip = template ? await root.JSZip.loadAsync(template,{base64:true}) : createBlankWorkbook();
    const get = path => zip.file(path).async("string");
    const rows = confirmedOnly ? result.rows.filter(r=>r.values[4] === "意向投资企业" && confirmed(r.values)) : result.rows;
    const end = rows.length + 1;
    const names = ["CountryOptions","UnitTypes","CompanyTypes","PartnerTypes","IndustryOptions"];
    const lists = [...names];
    lists[2] = 'IF(AND($E2="意向投资企业",$G2=""),CompanyTypes,EmptyOption)';
    lists[3] = 'IF(AND($E2="招商合作机构",$F2=""),PartnerTypes,EmptyOption)';
    const validations = lists.map((formula,i) => '<dataValidation type="list" allowBlank="'+(i === 2 || i === 3 ? 0 : 1)+'" showErrorMessage="1" errorStyle="stop" sqref="'+letters(3+i)+'2:'+letters(3+i)+Math.max(end,2)+'"><formula1>'+xml(formula)+'</formula1></dataValidation>').join("");
    let form = await get("xl/worksheets/sheet1.xml");
    form = form.replace(/<dimension ref="[^"]+"\/>/, '<dimension ref="A1:V'+end+'"/>')
      .replace("</sheetData>", rows.map((row,index) => rowXml([index+1,...row.values.slice(1)],index+2)).join("") + "</sheetData><autoFilter ref=\"A1:V"+end+"\"/>")
      // Excel requires phoneticPr to precede dataValidations.
      .replace("<pageMargins", '<dataValidations count="'+lists.length+'">'+validations+'</dataValidations><pageMargins');
    zip.file("xl/worksheets/sheet1.xml",form);
    const optionData = [["国别（地区）","参会单位类型","企业机构性质1","企业机构性质2","行业领域"],...Array.from({length:Math.max(...choiceColumns.map(c=>c.length))},(_,i)=>choiceColumns.map(c=>c[i] ?? ""))];
    const reviewData = [["数据日期","原表行号","事项","原填值"],...result.notices.map(n=>[date,n.line,n.label,n.value])];
    const duplicateData = [["数据日期","参会集团","邀请单位","原填处室或单位","嘉宾姓名","嘉宾职务","参会意向","嘉宾资料","原表行号"]];
    for (const group of result.duplicates) for (const [unit,guests] of group.units) for (const guest of guests) {
      duplicateData.push([date,group.name,unit,guest.department,guest.guest,guest.position,guest.confirmed?"已确认":"待确认",guest.complete?"齐全":"待补齐",guest.line]);
    }
    const confirmedData = [["数据日期","参会集团","国别（地区）","确认意向的嘉宾","嘉宾职务","嘉宾国籍","涉及邀请单位"], ...result.confirmedEnterprises.map(g=>{
      const guests = [...g.guests.values()];
      return [date,g.name,[...g.locations].join("、"),...([8,9,10].map(i=>guests.map(r=>r[i] || "待补齐").join("；"))),[...g.units].join("、")];
    })];
    const optionSheet = ["选项卡",optionData,[18,22,26,32,40]];
    const confirmedGroupKeys = new Set(result.confirmedEnterprises.map(g=>key(g.name)));
    const relatedData = [[...headers,"嘉宾参会意向","嘉宾资料","全部邀请来源","原表行号"]];
    if (confirmedOnly) for (const row of result.rows) {
      if (!confirmedGroupKeys.has(key(row.values[1]))) continue;
      relatedData.push([...row.values,confirmed(row.values)?"已确认":"待确认",guestComplete(row.values)?"齐全":"待补齐",[...row.sources].join("、"),row.lines.join("、")]);
    }
    const relatedWidths = [8,42,28,16,21,25,29,28,19,38,18,19,20,24,22,20,20,24,26,26,18,45,16,16,36,20];
    const sheets = confirmedOnly ? [
      ["确认参会集团",confirmedData,[15,44,18,36,52,25,42]],
      ["确认企业全部明细",relatedData,relatedWidths],
      optionSheet
    ] : [
      optionSheet,
      ["待复核",reviewData,[15,12,48,66]],
      ["跨单位重复邀请",duplicateData,[15,38,26,30,22,36,14,14,12]]
    ];
    let workbook = await get("xl/workbook.xml");
    let rels = await get("xl/_rels/workbook.xml.rels");
    let types = await get("[Content_Types].xml");
    const existingSheets = children(node(parseXml(workbook),"sheets"),"sheet");
    const lastSheetId = Math.max(...existingSheets.map(sheet=>Number(sheet.attrs.sheetId)));
    sheets.forEach(([name,data,widths],i) => {
      const n = i+2;
      workbook = workbook.replace("</sheets>",'<sheet name="'+xml(name)+'" sheetId="'+(lastSheetId+i+1)+'" r:id="rId'+(90+n)+'"/></sheets>');
      rels = rels.replace("</Relationships>",'<Relationship Id="rId'+(90+n)+'" Type="'+relationshipXml+'/worksheet" Target="worksheets/sheet'+n+'.xml"/></Relationships>');
      types = types.replace("</Types>",'<Override PartName="/xl/worksheets/sheet'+n+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
      zip.file("xl/worksheets/sheet"+n+".xml",simpleSheet(data,widths));
    });
    const defined = names.map((name,i) => '<definedName name="'+name+'">\'选项卡\'!$'+letters(i)+'$2:$'+letters(i)+'$'+(choiceColumns[i].length+1)+'</definedName>').join("") + '<definedName name="EmptyOption">\'选项卡\'!$F$2</definedName>';
    workbook = workbook.includes("<definedNames>") ? workbook.replace("</definedNames>",defined+"</definedNames>") :
      workbook.replace("</sheets>","</sheets><definedNames>"+defined+"</definedNames>");
    zip.file("xl/workbook.xml",workbook);
    zip.file("xl/_rels/workbook.xml.rels",rels);
    zip.file("[Content_Types].xml",types);
    const sheetNames = [...existingSheets.map(sheet=>sheet.attrs.name),...sheets.map(([name])=>name)];
    const appProperties = (await get("docProps/app.xml"))
      .replace(/<vt:i4>\d+<\/vt:i4>/, '<vt:i4>'+sheetNames.length+'</vt:i4>')
      .replace(/<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/, '<TitlesOfParts><vt:vector size="'+sheetNames.length+'" baseType="lpstr">'+
        sheetNames.map(name=>'<vt:lpstr>'+xml(name)+'</vt:lpstr>').join("")+'</vt:vector></TitlesOfParts>');
    zip.file("docProps/app.xml",appProperties);
    return zip.generateAsync({type:"uint8array",compression:"DEFLATE"});
  }
  function rankingKeys(name) {
    const normalized = clean(name);
    const withoutCountry = normalized.slice(nameCountry(normalized).length);
    const bilingual = /^(.*?)\(([a-z][a-z .&,'-]*)\)$/i.exec(withoutCountry);
    return [...new Set((bilingual ? bilingual.slice(1) : [withoutCountry]).map(core).filter(Boolean))];
  }
  function guestLevel(title) {
    const value = clean(title).toLowerCase();
    if (/(助理|assistant\s+to|executive assistant|秘书|secretary)/i.test(value) || /^(董事|创始人|联合创始人|负责人)$/.test(value)) return 5;
    if (/副董事长|副总裁|\b[se]?vp\b|vice president/.test(value)) return 2;
    if (/副总经理|总经理|general manager/.test(value)) return 3;
    if (/董事长|\bceo\b|首席执行官|总裁|chairman|chief executive officer/.test(value)) {
      return /区|分公司|子公司|regional|china|apac/i.test(value) ? 2 : 1;
    }
    if (/总监|部门负责人|经理|director|\bmanager\b/.test(value)) return 4;
    return 5;
  }
  const categorySequence = value => Number(/^\d+/.exec(value)?.[0] ?? 99);
  function rankingMatcher(lists) {
    const indexes = lists.map(rows=>{
      const index = new Map();
      for (const row of rows) for (const value of [row.name,...row.aliases]) {
        for (const alias of rankingKeys(value)) {
          if (!index.has(alias)) index.set(alias,new Set());
          index.get(alias).add(row);
        }
      }
      return index;
    });
    return company=>indexes.map(index=>{
        const candidates = new Set();
        const names = [...company.applicants,...(company.verifiedGroup ? [company.name] : [])];
        for (const name of names) for (const alias of rankingKeys(name)) {
          for (const row of index.get(alias) ?? []) candidates.add(row);
        }
        const listIndex = indexes.indexOf(index);
        for (const applicant of company.applicants) {
          const rule = reviewRules.get(key(applicant));
          const rank = rule?.ranks[listIndex];
          const source = RankingData.lists[listIndex].find(row=>row.rank===rank);
          const entry = lists[listIndex].find(row=>row.rank===rank && row.name===source?.name);
          if (entry) candidates.add(entry);
        }
        return { row:candidates.size===1 ? [...candidates][0] : null, ambiguous:candidates.size>1 };
    });
  }
  function rankingAudit(result, lists) {
    const match = rankingMatcher(lists);
    const complete = lists.map(list=>new Set(list.map(entry=>entry.rank)).size===500);
    return result.rankingCompanies.map(company=>{
      const matches = match(company);
      const reviewed = [...new Set([...company.applicants].map(name=>reviewRules.get(key(name))).filter(Boolean))];
      const reported = new Set([...company.categories].map(categorySequence));
      const issues = reviewed.filter(rule=>rule.pending).map(rule=>rule.note);
      const eligible = new Set();
      const location = company.locations.size===1 ? [...company.locations][0] : "";
      if (matches[0].row) {
        if (location) {
          const worldCategory = location==="中国" ? 2 : 1;
          eligible.add(worldCategory);
          if (reported.has(worldCategory===1 ? 2 : 1)) issues.push("世界500强内外资类别与集团国别不一致");
        }
        else issues.push("世界500强已匹配，集团国别待核对");
      }
      if (matches[1].row) eligible.add(3);
      if (eligible.size && ![...eligible].some(code=>reported.has(code))) {
        issues.push("榜单对应第 "+[...eligible].sort().join("、")+" 项，请核对企业机构性质1");
      }
      matches.forEach((entry,index)=>{
        if (entry.ambiguous) issues.push(rankingLabels[index]+"存在多个匹配项");
        const claimed = index===0 ? reported.has(1)||reported.has(2) : reported.has(3);
        if (claimed && complete[index] && !entry.row && !entry.ambiguous) {
          issues.push("原填类别在完整榜单中未匹配，请核对名称或集团归属");
        }
      });
      return {company,matches,issues};
    }).sort((a,b)=>Number(!!b.issues.length)-Number(!!a.issues.length)||a.company.name.localeCompare(b.company.name,"zh"));
  }
  function priorityGroups(result, selected, lists) {
    const match = rankingMatcher(lists);
    const rank = (group,index) => group.matches[index].row?.rank ?? 501;
    return result.confirmedEnterprises.flatMap(company=>{
      const categories = [...company.categories].filter(c=>selected.has(c)).sort((a,b)=>categorySequence(a)-categorySequence(b));
      if (!categories.length) return [];
      const guests = [...company.guests.values()].map(values=>({values,level:guestLevel(values[9])})).sort((a,b)=>a.level-b.level);
      return [{ company,categories,guests,matches:match(company),sequence:categorySequence(categories[0]) }];
    }).sort((a,b)=>a.sequence-b.sequence
      || rank(a,0)-rank(b,0)
      || rank(a,1)-rank(b,1)
      || a.guests[0].level-b.guests[0].level
      || a.company.name.localeCompare(b.company.name,"zh"));
  }
  const attendanceYes = /^(是|已确认(?:参会|参加)?|确认(?:参会|参加)?|参加|参会|yes)$/i;
  const attendanceNo = /^(否|不参加|不参会|无法参会|取消参会|no)$/i;
  function guestAttendance(result) {
    const people = new Map();
    const domestic = new Set(["中国","中国香港","中国澳门","中国台湾","香港","澳门","台湾"]);
    for (const {values} of result.rows) {
      if (!confirmed(values)) continue;
      const id = JSON.stringify([key(values[1]),key(values[8])]);
      const attendance = clean(values[16]);
      if (!people.has(id)) people.set(id,{yes:false,no:false,countries:new Set()});
      const person = people.get(id);
      person.yes ||= attendanceYes.test(attendance);
      person.no ||= attendanceNo.test(attendance);
      const raw = clean(values[10]);
      const nationality = /^(港籍|香港籍)$/.test(raw) ? "中国香港" : country(raw);
      if (nationality) person.countries.add(nationality === "中国香港" ? nationality : domestic.has(nationality) ? "中国" : nationality);
    }
    const counts = {total:0,domestic:0,hongKong:0,foreign:0,unknown:0};
    for (const person of people.values()) {
      if (!person.yes || person.no) continue;
      counts.total++;
      if (person.countries.size !== 1) counts.unknown++;
      else if (person.countries.has("中国香港")) counts.hongKong++;
      else if (person.countries.has("中国")) counts.domestic++;
      else counts.foreign++;
    }
    return counts;
  }
  function dailySummary(result, date) {
    const companies = new Map();
    for (const {values} of result.rows) {
      const [ ,name,,,type,category,,,guest,title,,,,,,,attendance] = values;
      if (!name || type!=="意向投资企业" || !confirmed(values)) continue;
      const id=key(name);
      if (!companies.has(id)) companies.set(id,{name,categories:new Set(),guests:new Map()});
      const company=companies.get(id);
      const guestId=key(guest);
      if (!company.guests.has(guestId)) company.guests.set(guestId,{guest,confirmedTitles:[],declined:false});
      const person=company.guests.get(guestId);
      if (attendanceNo.test(clean(attendance))) person.declined=true;
      const level=guestLevel(title);
      if (attendanceYes.test(clean(attendance))) person.confirmedTitles.push({title,level});
      const code=categorySequence(category);
      if (code!==99) company.categories.add(code);
    }
    const intents = [];
    for (const company of companies.values()) {
      const guests = [...company.guests.values()];
      if (!guests.length) continue;
      const confirmedGuests = guests.filter(person=>!person.declined).flatMap(person=>person.confirmedTitles
        .map(({title,level})=>({guest:person.guest,title,level}))
        .sort((a,b)=>a.level-b.level).slice(0,1)).sort((a,b)=>a.level-b.level);
      intents.push({...company,confirmedGuests,priority:Math.min(99,...company.categories)});
    }
    const ordered = intents.sort((a,b)=>a.priority-b.priority ||
      (a.confirmedGuests[0]?.level ?? 99)-(b.confirmedGuests[0]?.level ?? 99) || a.name.localeCompare(b.name,"zh"));
    const publishable = value=>!/(待定|待确认|待核实|暂定|拟邀|待补)/.test(value);
    const inviteNames = [...result.rankingCompanies].filter(company=>publishable(company.name) && company.categories.size)
      .sort((a,b)=>Math.min(...[...a.categories].map(categorySequence))-Math.min(...[...b.categories].map(categorySequence)) ||
        a.name.localeCompare(b.name,"zh")).slice(0,21).map(company=>company.name);
    const confirmedCompanies = ordered.filter(company=>company.confirmedGuests.length && publishable(company.name));
    const confirmedNames = confirmedCompanies.slice(0,6).map(company=>company.name);
    const guestNames = confirmedCompanies.flatMap(company=>{
      const guest=company.confirmedGuests.find(person=>person.level<=3 && publishable(person.guest) && publishable(person.title));
      return guest ? [company.name+guest.title+guest.guest] : [];
    }).slice(0,8);
    const enterprises = result.confirmedEnterprises;
    const {invited,feedback,units} = result.invitationStats;
    const day = date ? "截至"+date.replace(/^\d{4}-(\d{2})-(\d{2})$/,(_,m,d)=>Number(m)+"月"+Number(d)+"日")+"，" : "";
    const leaders = units.slice(0,4).map(unit=>unit.name);
    const leadingUnits = leaders.length ? "，其中，"+leaders.join("、")+"登记邀请数量靠前" : "";
    const focus = inviteNames.length ? "邀请包括"+inviteNames.join("、")+"等企业。" : "";
    const confirmedText = confirmedNames.length ? "目前，已接受邀请和确认参会的公司包括"+confirmedNames.join("、")+"等。" :
      ordered.some(company=>company.confirmedGuests.length) ? "" : "本批暂无明确确认参加主会场的企业。";
    const guestText = guestNames.length ? "明确参会嘉宾包括"+guestNames.join("、")+"。" : "";
    const metrics = [["登记邀请企业和机构",invited,"家"],["初步意向反馈",feedback,"家"],["初步意向去重后",enterprises.length,"家"]];
    const text = "一、整体情况\n"+day+"全市各区各相关部门共登记邀请"+invited+"家企业和机构"+leadingUnits+"。"+
      focus+"已收到初步意向参会企业反馈"+feedback+"家，去重后为"+enterprises.length+"家。\n\n"+confirmedText+guestText;
    return {text,metrics};
  }
  const priorityLevels = ["集团高层","集团副职或区域高层","区域或子公司管理层","部门管理层","待核实"];
  const rankingLabels = ["2026《财富》世界500强","2026全国工商联中国民营企业500强"];
  async function exportPriority(rows, date) {
    const widths = [15,34,40,40,19,20,38,29,30,44,44];
    const sheetName = "重点企业候选";
    const data = [["数据日期","企业机构性质1","集团名称","参会主体","国别（地区）","嘉宾姓名","原填职务","职级","邀请单位",...rankingLabels]];
    for (const {company,categories,guests,matches} of rows) {
      for (const {values,level} of guests) {
        data.push([date,categories.join("、"),company.name,[...company.applicants].join("、"),
          values[3],values[8],values[9],priorityLevels[level-1],values[13],
          ...matches.map(match=>match.row ? "第 "+match.row.rank+" 名 · "+match.row.name : match.ambiguous ? "有多个对应企业，待核对" : "当前名单未匹配")]);
      }
    }
    const zip = createBlankWorkbook(widths);
    zip.file("xl/worksheets/sheet1.xml",simpleSheet(data,widths));
    for (const file of ["xl/workbook.xml","docProps/app.xml"]) {
      zip.file(file,(await zip.file(file).async("string")).replace(/\bform\b/,sheetName));
    }
    return zip.generateAsync({type:"uint8array",compression:"DEFLATE"});
  }
  return { readExcel, process, exportExcel, exportPriority, options:baseOptions, inviters, headers, confirmed, guestComplete, title, priorityGroups, rankingAudit, dailySummary, guestAttendance, priorityLevels, rankingLabels };
};
if (globalThis.RULES) globalThis.Workbench = globalThis.createWorkbench(globalThis.RULES);
