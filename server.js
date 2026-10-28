// Serveur Pronos Foot : récupère les matchs, calcule les probabilités (Elo) et sert le site.
const http=require("http"),fs=require("fs"),path=require("path");
const KEY=process.env.FOOTBALL_DATA_KEY,PORT=process.env.PORT||3000;
const COMPS={"Ligue 1":"FL1","Premier League":"PL","Liga":"PD","Serie A":"SA","Bundesliga":"BL1","Ligue des champions":"CL"};
const CACHE=path.join(__dirname,"data.json");
let data={updated:null,matches:{},form:{}};
try{data=JSON.parse(fs.readFileSync(CACHE,"utf8"))}catch{}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fmt=new Intl.DateTimeFormat("fr-FR",{weekday:"short",day:"numeric",month:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"});
const nm=t=>t.shortName||t.name;

// Elo calculé sur les matchs terminés de la saison (avantage du terrain : +60)
function model(finished){
  const elo={},form={},g=t=>elo[t]??1500;
  for(const m of finished){
    const h=nm(m.homeTeam),a=nm(m.awayTeam),sh=m.score.fullTime.home,sa=m.score.fullTime.away;
    if(sh==null||sa==null)continue;
    const e=1/(1+10**(-(g(h)+60-g(a))/400)),s=sh>sa?1:sh==sa?.5:0,K=20*(1+.3*Math.min(Math.abs(sh-sa),3));
    elo[h]=g(h)+K*(s-e);elo[a]=g(a)-K*(s-e);
    (form[h]??=[]).push(s==1?"V":s==.5?"N":"D");
    (form[a]??=[]).push(s==0?"V":s==.5?"N":"D");
  }
  return{elo,form};
}
function probs(h,a,elo){
  const g=t=>elo[t]??1500,e=1/(1+10**(-(g(h)+60-g(a))/400));
  const pd=Math.max(.08,.30-.22*Math.abs(2*e-1));
  return[(1-pd)*e,pd,(1-pd)*(1-e)].map(x=>Math.round(x*1000)/10);
}
async function refresh(){
  if(!KEY)return console.log("FOOTBALL_DATA_KEY manquante");
  const now=new Date(),year=now.getMonth()>=6?now.getFullYear():now.getFullYear()-1;
  const out={matches:{},form:{}};
  for(const[name,code]of Object.entries(COMPS)){
    try{
      const r=await fetch(`https://api.football-data.org/v4/competitions/${code}/matches?season=${year}`,{headers:{"X-Auth-Token":KEY}});
      if(!r.ok)throw new Error("HTTP "+r.status);
      const j=await r.json(),by=(a,b)=>a.utcDate<b.utcDate?-1:1;
      const{elo,form}=model(j.matches.filter(m=>m.status=="FINISHED").sort(by));
      out.matches[name]=j.matches.filter(m=>["SCHEDULED","TIMED"].includes(m.status)&&m.homeTeam.name&&m.awayTeam.name)
        .sort(by).slice(0,10).map(m=>{
          const h=nm(m.homeTeam),a=nm(m.awayTeam);
          return[h,a,fmt.format(new Date(m.utcDate)).replace(",",""),...probs(h,a,elo)];
        });
      for(const t in form)out.form[t]=form[t].slice(-3).join("");
    }catch(e){console.log(name,e.message);out.matches[name]=data.matches[name]||[]}
    await sleep(7000); // limite de l'offre gratuite : 10 requêtes/minute
  }
  data={updated:new Date().toISOString(),...out};
  fs.writeFileSync(CACHE,JSON.stringify(data));
  console.log("Mise à jour OK",data.updated);
}
http.createServer((q,s)=>{
  if(q.url.startsWith("/api/matches")){
    s.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});
    return s.end(JSON.stringify(data));
  }
  s.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
  s.end(fs.readFileSync(path.join(__dirname,"index.html")));
}).listen(PORT,()=>console.log("Site sur le port",PORT));
refresh();
setInterval(refresh,6*3600e3); // renouvelé toutes les 6 heures
