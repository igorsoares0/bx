(function(){
var BXAPP_API_BASE=window.__bxappApiBase||'';
function bxTrack(t,ev,bt,bi,pi){try{var base=t.apiBase||BXAPP_API_BASE;if(!base)return;var url=base+'/api/analytics';fetch(url,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({shop:t.shop,eventType:ev,bundleType:bt,bundleId:bi||null,productId:pi||null}),keepalive:true,mode:'cors'}).catch(function(){});}catch(e){}}
var COLOR_MAP={'red':'#e53e3e','vermelho':'#e53e3e','blue':'#3182ce','azul':'#3182ce','green':'#38a169','verde':'#38a169','yellow':'#ecc94b','amarelo':'#ecc94b','black':'#1a202c','preto':'#1a202c','white':'#fff','branco':'#fff','pink':'#ed64a6','rosa':'#ed64a6','purple':'#805ad5','roxo':'#805ad5','orange':'#dd6b20','laranja':'#dd6b20','gray':'#a0aec0','grey':'#a0aec0','cinza':'#a0aec0','brown':'#8b6914','marrom':'#8b6914','navy':'#2a4365','marinho':'#2a4365','beige':'#f5f0e1','bege':'#f5f0e1','gold':'#d69e2e','dourado':'#d69e2e','silver':'#cbd5e0','prata':'#cbd5e0','coral':'#fc8181','turquoise':'#38b2ac','turquesa':'#38b2ac','wine':'#722f37','vinho':'#722f37','cream':'#fffdd0','creme':'#fffdd0'};
function getColorHex(n){return n?COLOR_MAP[n.toLowerCase().trim()]||null:null;}
function isColorOpt(n){var l=n.toLowerCase();return l==='cor'||l==='color'||l==='colour'||l==='cor/color';}
function findVariant(pdata,opts){for(var i=0;i<pdata.variants.length;i++){var v=pdata.variants[i],match=true;for(var j=0;j<opts.length;j++){if(opts[j]!=null&&v.options[j]!==opts[j]){match=false;break;}}if(match)return v;}return null;}

var dataMap=window.__bxappComp||{};
Object.keys(dataMap).forEach(function(widgetId){
  var D=dataMap[widgetId];
  if(D._i)return;D._i=true;
  var W=document.getElementById('bxgy-fbt-'+widgetId);
  if(!W)return;

  var _t=D._track||{};
  bxTrack(_t,'view','complement',_t.bundleId,_t.productId);

  var shopCurrency=D.currency;
  var bundleMode=W.getAttribute('data-fbt-mode')||'fbt';
  var triggerDiscountPct=parseFloat(W.getAttribute('data-fbt-trigger-discount-pct'))||0;
  var showVariants=D.showVariants===true;
  var bv=D.buyVariants||{};
  var compProductData=D.compProducts||{};
  var mainPrice=D.mainPrice||0;

  var selectedGroup=null;
  var comboSelected=false;

  function fmt(cents){return new Intl.NumberFormat(undefined,{style:'currency',currency:shopCurrency||'USD'}).format(cents/100);}

  function detectBuyVariant(){
    var p=new URLSearchParams(window.location.search);var u=p.get('variant');
    if(u&&bv[u])return u;
    var inp=document.querySelector('form[action*="/cart/add"] input[name="id"]');
    if(inp&&inp.value&&bv[inp.value])return inp.value;
    var sel=document.querySelector('form[action*="/cart/add"] select[name="id"]');
    if(sel&&sel.value&&bv[sel.value])return sel.value;
    var keys=Object.keys(bv);
    for(var i=0;i<keys.length;i++){if(bv[keys[i]].available)return keys[i];}
    return keys[0]||null;
  }

  var curVid=detectBuyVariant();
  var curPrice=curVid&&bv[curVid]?bv[curVid].price:mainPrice;

  var compCards=W.querySelectorAll('[data-fbt-comp-card]');
  var byGroup={};var allComps=[];
  for(var i=0;i<compCards.length;i++){
    var c=compCards[i];var g=parseInt(c.getAttribute('data-fbt-comp-group'),10)||0;
    var obj={el:c,handle:c.getAttribute('data-fbt-comp-handle')||'',variantId:c.getAttribute('data-fbt-comp-variant-id'),discountPct:parseFloat(c.getAttribute('data-fbt-comp-discount-pct'))||0,price:parseInt(c.getAttribute('data-fbt-comp-price'),10)||0,quantity:parseInt(c.getAttribute('data-fbt-comp-quantity'),10)||1};
    if(!byGroup[g])byGroup[g]=[];
    byGroup[g].push(obj);allComps.push(obj);
  }
  var groupKeys=Object.keys(byGroup).map(Number).sort(function(a,b){return a-b;});

  function buildCompVariants(){
    if(!showVariants)return;
    var containers=W.querySelectorAll('[data-fbt-cv]');
    for(var ci=0;ci<containers.length;ci++){
      var cont=containers[ci];var handle=cont.getAttribute('data-fbt-cv');
      var pdata=compProductData[handle];if(!pdata)continue;
      var card=cont.closest('[data-fbt-comp-card]');
      var currentVid=card?card.getAttribute('data-fbt-comp-variant-id'):null;
      var currentVariant=null;
      for(var vi=0;vi<pdata.variants.length;vi++){if(pdata.variants[vi].id===currentVid){currentVariant=pdata.variants[vi];break;}}
      if(!currentVariant)currentVariant=pdata.variants[0];
      var html='';
      for(var oi=0;oi<pdata.options.length;oi++){
        var opt=pdata.options[oi];var isColor=isColorOpt(opt.name);
        var curVal=currentVariant?currentVariant.options[oi]:opt.values[0];
        html+='<div class="bxgy-fbt__cv-opt">';
        if(isColor){var hex=getColorHex(curVal);if(hex)html+='<span class="bxgy-fbt__cv-dot" style="background:'+hex+'"></span>';}
        html+='<select class="bxgy-fbt__cv-sel" data-cv-handle="'+handle+'" data-cv-opt="'+oi+'">';
        for(var vi=0;vi<opt.values.length;vi++){var v=opt.values[vi];html+='<option value="'+v.replace(/"/g,'&quot;')+'"'+(v===curVal?' selected':'')+'>'+v+'</option>';}
        html+='</select></div>';
      }
      cont.innerHTML=html;
      var selects=cont.querySelectorAll('.bxgy-fbt__cv-sel');
      selects.forEach(function(sel){
        sel.addEventListener('click',function(e){e.stopPropagation();});
        sel.addEventListener('change',function(e){
          e.stopPropagation();
          var h=sel.getAttribute('data-cv-handle');var oi2=parseInt(sel.getAttribute('data-cv-opt'),10);
          var pd=compProductData[h];if(!pd)return;
          var parentCont=sel.closest('[data-fbt-cv]');var allSels=parentCont.querySelectorAll('.bxgy-fbt__cv-sel');
          var opts=[];allSels.forEach(function(s){opts.push(s.value);});
          var newVar=findVariant(pd,opts);var theCard=parentCont.closest('[data-fbt-comp-card]');
          if(newVar&&theCard){
            theCard.setAttribute('data-fbt-comp-variant-id',newVar.id);
            theCard.setAttribute('data-fbt-comp-price',String(newVar.price));
            for(var ai=0;ai<allComps.length;ai++){if(allComps[ai].el===theCard){allComps[ai].variantId=newVar.id;allComps[ai].price=newVar.price;break;}}
          }
          if(isColorOpt(pd.options[oi2].name)){
            var dot=sel.parentElement.querySelector('.bxgy-fbt__cv-dot');var hx=getColorHex(sel.value);
            if(dot){dot.style.background=hx||'transparent';dot.style.display=hx?'':'none';}
            else if(hx){var nd=document.createElement('span');nd.className='bxgy-fbt__cv-dot';nd.style.background=hx;sel.parentElement.insertBefore(nd,sel);}
          }
          updatePrices();
        });
      });
    }
  }

  var totalOrigEl=W.querySelector('[data-fbt-total-original]');
  var totalFinEl=W.querySelector('[data-fbt-total-final]');
  var savingsEl=W.querySelector('[data-fbt-savings]');
  var addBtn=W.querySelector('[data-fbt-add-btn]');
  var feedbackEl=W.querySelector('[data-fbt-feedback]');
  var stdPriceEl=W.querySelector('[data-fbt-standard-price]');
  var allRadios=W.querySelectorAll('[data-fbt-radio]');

  function calcGroup(gIdx){
    var comps=byGroup[gIdx]||[];var tOrig=curPrice;var tFin=Math.round(curPrice*(1-triggerDiscountPct/100));
    for(var i=0;i<comps.length;i++){var q=comps[i].quantity||1;tOrig+=comps[i].price*q;tFin+=Math.round(comps[i].price*(1-comps[i].discountPct/100))*q;}
    return{orig:tOrig,fin:tFin,save:tOrig-tFin};
  }

  function updatePrices(){
    if(curVid&&bv[curVid])curPrice=bv[curVid].price;
    if(bundleMode==='combo'){
      if(stdPriceEl)stdPriceEl.textContent=fmt(curPrice);
      for(var i=0;i<groupKeys.length;i++){
        var g=groupKeys[i];var t=calcGroup(g);
        var sEl=W.querySelector('[data-fbt-combo-savings-'+g+']');
        var oEl=W.querySelector('[data-fbt-combo-original-'+g+']');
        var fEl=W.querySelector('[data-fbt-combo-final-'+g+']');
        if(sEl)sEl.textContent=t.save>0?'Save '+fmt(t.save)+'!':'';
        if(oEl)oEl.textContent=t.save>0?fmt(t.orig):'';
        if(fEl)fEl.textContent=fmt(t.fin);
      }
      if(comboSelected&&selectedGroup!==null){
        var sel2=calcGroup(selectedGroup);
        if(totalOrigEl)totalOrigEl.textContent=sel2.save>0?fmt(sel2.orig):'';
        if(totalFinEl)totalFinEl.textContent=fmt(sel2.fin);
        if(savingsEl)savingsEl.textContent=sel2.save>0?'You save '+fmt(sel2.save):'';
      }else{
        if(totalOrigEl)totalOrigEl.textContent='';
        if(totalFinEl)totalFinEl.textContent=fmt(curPrice);
        if(savingsEl)savingsEl.textContent='';
      }
    }else{
      var tO=curPrice,tF=curPrice;
      for(var i2=0;i2<allComps.length;i2++){var q=allComps[i2].quantity||1;tO+=allComps[i2].price*q;tF+=Math.round(allComps[i2].price*(1-allComps[i2].discountPct/100))*q;}
      var s=tO-tF;
      if(totalOrigEl)totalOrigEl.textContent=s>0?fmt(tO):'';
      if(totalFinEl)totalFinEl.textContent=fmt(tF);
      if(savingsEl)savingsEl.textContent=s>0?'You save '+fmt(s):'';
    }
  }

  function onVarChange(vid){if(vid&&bv[vid]){curVid=vid;updatePrices();}}
  function checkUrl(){var v=new URLSearchParams(window.location.search).get('variant');if(v&&v!==curVid)onVarChange(v);}
  window.addEventListener('popstate',checkUrl);
  document.addEventListener('variant:changed',function(e){if(e.detail&&e.detail.variant&&e.detail.variant.id)onVarChange(String(e.detail.variant.id));});
  var vi=document.querySelector('form[action*="/cart/add"] input[name="id"]');
  if(vi){new MutationObserver(function(){onVarChange(vi.value);}).observe(vi,{attributes:true,attributeFilter:['value']});var vs=document.querySelector('form[action*="/cart/add"] select[name="id"]');if(vs)vs.addEventListener('change',function(){onVarChange(vs.value);});}
  var lastUrl=window.location.href;
  setInterval(function(){if(window.location.href!==lastUrl){lastUrl=window.location.href;checkUrl();}},500);

  function showFB(type,msg){feedbackEl.textContent=msg;feedbackEl.className='bxgy-fbt__feedback bxgy-fbt__feedback--'+type;if(type==='success')setTimeout(function(){feedbackEl.className='bxgy-fbt__feedback';},4000);}

  function updCart(){
    document.documentElement.dispatchEvent(new CustomEvent('cart:refresh',{bubbles:true}));
    fetch('/cart.js',{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(cart){
      document.querySelectorAll('.cart-count-bubble span, .cart-count, [data-cart-count], .js-cart-count, #cart-icon-bubble span').forEach(function(el){el.textContent=cart.item_count;});
    }).catch(function(){});
  }

  function getBundleItems(){
    var vid=detectBuyVariant();
    var bxProps={'_bxapp_bundle_type':'complement','_bxapp_bundle_id':String(_t.bundleId||'')};
    var items=[];
    if(bundleMode==='combo'&&!comboSelected){if(vid)items.push({id:Number(vid),quantity:1});}
    else{if(vid)items.push({id:Number(vid),quantity:1,properties:bxProps});var list=(bundleMode==='combo'&&selectedGroup!==null)?(byGroup[selectedGroup]||[]):allComps;for(var i=0;i<list.length;i++){if(list[i].variantId)items.push({id:Number(list[i].variantId),quantity:list[i].quantity||1,properties:bxProps});}}
    return items;
  }

  // ── Native button mode: intercept theme's add-to-cart form ──
  if(D.useNativeButton){
    var nativeForm=document.querySelector('form[action*="/cart/add"]');
    if(nativeForm){
      var bxCompProps={'_bxapp_bundle_type':'complement','_bxapp_bundle_id':String(_t.bundleId||'')};

      function injectCompProps(){
        nativeForm.querySelectorAll('input[name^="properties[_bxapp_"]').forEach(function(el){el.remove();});
        if(bundleMode!=='combo'||comboSelected){
          Object.keys(bxCompProps).forEach(function(k){
            var h=document.createElement('input');h.type='hidden';h.name='properties['+k+']';h.value=bxCompProps[k];nativeForm.appendChild(h);
          });
        }
      }

      window.__bxappNativeOwner=window.__bxappNativeOwner||null;
      function claimNative(){window.__bxappNativeOwner='complement_'+widgetId;injectCompProps();}
      claimNative();

      nativeForm.addEventListener('submit',function(){
        if(window.__bxappNativeOwner==='complement_'+widgetId){injectCompProps();}
      },true);

      // Intercept fetch for /cart/add and cartCreate (Buy it Now)
      var origFetch=window.fetch;
      window.fetch=function(url,opts){
        var urlStr=typeof url==='string'?url:(url&&url.url?url.url:'');
        if(urlStr&&window.__bxappNativeOwner==='complement_'+widgetId){
          var isBundle=(bundleMode!=='combo'||comboSelected);

          // /cart/add (Add to Cart)
          if(isBundle&&urlStr.indexOf('/cart/add')!==-1&&opts&&opts.body){
            try{
              var already=false;
              if(typeof opts.body==='string'){try{var chk=JSON.parse(opts.body);if(chk.items){chk.items.forEach(function(it){if(it.properties&&it.properties._bxapp_bundle_type)already=true;});}else if(chk.properties&&chk.properties._bxapp_bundle_type)already=true;}catch(e){}}
              else if(opts.body instanceof FormData&&opts.body.get('properties[_bxapp_bundle_type]'))already=true;
              if(!already){
                var bundleItems=getBundleItems();
                if(bundleItems.length>1){
                  var mvSec=null,mvSecUrl=null;
                  if(typeof opts.body==='string'){try{var ob=JSON.parse(opts.body);mvSec=ob.sections;mvSecUrl=ob.sections_url;}catch(e){}}
                  else if(opts.body instanceof FormData){mvSec=opts.body.get('sections');mvSecUrl=opts.body.get('sections_url');}
                  var mvBody={items:bundleItems};if(mvSec)mvBody.sections=mvSec;if(mvSecUrl)mvBody.sections_url=mvSecUrl;
                  opts={method:opts.method||'POST',credentials:opts.credentials||'same-origin',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(mvBody)};
                }
              }
            }catch(ex){}
          }

          // cartCreate (Buy it Now via Storefront API GraphQL)
          if(isBundle&&urlStr.indexOf('cartCreate')!==-1){
            var rawBody=opts&&opts.body;
            if(typeof rawBody==='string'){
              try{
                var gql=JSON.parse(rawBody);
                if(gql.variables&&gql.variables.input&&gql.variables.input.lines){
                  var bundleItems2=getBundleItems();
                  if(bundleItems2.length>1){
                    var newLines=[];
                    for(var bi=0;bi<bundleItems2.length;bi++){newLines.push({merchandiseId:'gid://shopify/ProductVariant/'+bundleItems2[bi].id,quantity:bundleItems2[bi].quantity||1});}
                    gql.variables.input.lines=newLines;
                    opts=Object.assign({},opts,{body:JSON.stringify(gql)});
                  }
                }
              }catch(ex2){}
            }
          }
        }
        return origFetch.call(window,url,opts);
      };
    }
  }

  if(addBtn)addBtn.addEventListener('click',function(){
    if(addBtn.disabled)return;
    addBtn.disabled=true;addBtn.classList.add('bxgy-fbt__add-btn--loading');feedbackEl.className='bxgy-fbt__feedback';
    var items=[];var vid=detectBuyVariant();
    var bxProps={'_bxapp_bundle_type':'complement','_bxapp_bundle_id':String(_t.bundleId||'')};
    if(bundleMode==='combo'&&!comboSelected){if(vid)items.push({id:Number(vid),quantity:1});}
    else{if(vid)items.push({id:Number(vid),quantity:1,properties:bxProps});var list=(bundleMode==='combo'&&selectedGroup!==null)?(byGroup[selectedGroup]||[]):allComps;for(var i=0;i<list.length;i++){if(list[i].variantId)items.push({id:Number(list[i].variantId),quantity:list[i].quantity||1,properties:bxProps});}}
    if(!items.length){addBtn.disabled=false;addBtn.classList.remove('bxgy-fbt__add-btn--loading');showFB('error','No products to add.');return;}
    fetch('/cart/add.js',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({items:items})})
    .then(function(r){if(!r.ok)return r.json().then(function(d){throw new Error(d.description||d.message||'Failed');});return r.json();})
    .then(function(){addBtn.disabled=false;addBtn.classList.remove('bxgy-fbt__add-btn--loading');if(D.buttonAction==='checkout'){window.location.href='/checkout';}else{showFB('success','Bundle added to cart!');updCart();}})
    .catch(function(err){addBtn.disabled=false;addBtn.classList.remove('bxgy-fbt__add-btn--loading');showFB('error',err.message||'Something went wrong.');});
  });

  if(bundleMode==='combo'){
    function setSelection(type,gIdx){
      comboSelected=type==='combo';selectedGroup=comboSelected?gIdx:null;
      for(var r=0;r<allRadios.length;r++){
        var radio=allRadios[r];var rType=radio.getAttribute('data-fbt-radio');var rGroup=parseInt(radio.getAttribute('data-fbt-radio-group'),10);
        var active=false;if(type==='standard'&&rType==='standard')active=true;if(type==='combo'&&rType==='combo'&&rGroup===gIdx)active=true;
        radio.classList.toggle('bxgy-fbt__radio--active',active);
      }
      if(addBtn)addBtn.textContent=comboSelected?'Complete the Combo':'Add to Cart';
      if(D.useNativeButton&&window.__bxappNativeOwner==='complement_'+widgetId){var nf=document.querySelector('form[action*="/cart/add"]');if(nf){nf.querySelectorAll('input[name^="properties[_bxapp_"]').forEach(function(el){el.remove();});if(comboSelected){var bp={'_bxapp_bundle_type':'complement','_bxapp_bundle_id':String(_t.bundleId||'')};Object.keys(bp).forEach(function(k){var h=document.createElement('input');h.type='hidden';h.name='properties['+k+']';h.value=bp[k];nf.appendChild(h);});}}}
      updatePrices();
    }
    for(var r=0;r<allRadios.length;r++){(function(radio){radio.addEventListener('click',function(){var type=radio.getAttribute('data-fbt-radio');var gIdx=parseInt(radio.getAttribute('data-fbt-radio-group'),10)||0;setSelection(type,gIdx);});})(allRadios[r]);}
    if(groupKeys.length>0)setSelection('combo',groupKeys[groupKeys.length-1]);
  }

  buildCompVariants();
  updatePrices();
});
})();
