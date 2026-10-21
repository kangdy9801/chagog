(function(root){
const net=t=>Number(t.amount||0)-Number(t.discount||0);
function period(date,day){let [y,m,d]=date.split('-').map(Number);if(d<day){m--;if(m===0){m=12;y--}}return `${y}-${String(m).padStart(2,'0')}`}
const sum=(rows,fn=net)=>rows.reduce((a,r)=>a+fn(r),0);
const special=t=>['이월','기타'].includes(t.category);
function stats(data,key,day){const filter=a=>a.filter(t=>period(t.date,day)===key);let tx=filter(data.transactions),fixed=filter(data.fixed),income=filter(data.income);return {tx,fixed,income,variable:sum(tx),fixedTotal:sum(fixed),savings:sum([...tx,...fixed].filter(t=>t.category==='적금')),incomeTotal:sum(income),chartVariable:sum(tx.filter(t=>t.category!=='적금')),chartFixed:sum(fixed.filter(t=>t.category!=='적금'))}}
function budgetStats(rows,account,amount){let a=rows.filter(t=>t.account===account),used=sum(a.filter(t=>!special(t))),carry=sum(a.filter(special));return {used,carry,remaining:amount-used-carry}}
const api={net,period,sum,special,stats,budgetStats};if(typeof module!=='undefined')module.exports=api;else root.Ledger=api;
})(typeof window!=='undefined'?window:globalThis);
