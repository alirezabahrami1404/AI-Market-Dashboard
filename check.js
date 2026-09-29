node -e "
const d=require('./data/db.json');
d.periods.forEach((p,i)=>{
  const rows=d.data.filter(r=>r.period_idx===i);
  const withTotal=rows.filter(r=>r.total!=null);
  console.log(i, JSON.stringify(p), 'rows='+rows.length, 'sum_total='+withTotal.reduce((a,r)=>a+r.total,0));
});
"
