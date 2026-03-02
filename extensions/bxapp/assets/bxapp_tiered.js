(function(){
var BXAPP_API_BASE=window.__bxappApiBase||'';
function bxTrack(t,ev,bt,bi,pi){try{var url=BXAPP_API_BASE+'/api/analytics';fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({shop:t.shop,eventType:ev,bundleType:bt,bundleId:bi||null,productId:pi||null}),keepalive:true}).catch(function(){});}catch(e){}}
var COLOR_MAP={'red':'#e53e3e','vermelho':'#e53e3e','blue':'#3182ce','azul':'#3182ce','green':'#38a169','verde':'#38a169','yellow':'#ecc94b','amarelo':'#ecc94b','black':'#1a202c','preto':'#1a202c','white':'#fff','branco':'#fff','pink':'#ed64a6','rosa':'#ed64a6','purple':'#805ad5','roxo':'#805ad5','orange':'#dd6b20','laranja':'#dd6b20','gray':'#a0aec0','grey':'#a0aec0','cinza':'#a0aec0','brown':'#8b6914','marrom':'#8b6914','navy':'#2a4365','marinho':'#2a4365','beige':'#f5f0e1','bege':'#f5f0e1','gold':'#d69e2e','dourado':'#d69e2e','silver':'#cbd5e0','prata':'#cbd5e0','coral':'#fc8181','turquoise':'#38b2ac','turquesa':'#38b2ac','wine':'#722f37','vinho':'#722f37','cream':'#fffdd0','creme':'#fffdd0','sky blue':'#63b3ed','azul claro':'#63b3ed','dark green':'#276749','verde escuro':'#276749','light blue':'#90cdf4','light green':'#9ae6b4','dark blue':'#2b6cb0','azul escuro':'#2b6cb0'};
function getColorHex(name){return name?COLOR_MAP[name.toLowerCase().trim()]||null:null;}
function isColorOption(n){var l=n.toLowerCase();return l==='cor'||l==='color'||l==='colour'||l==='cor/color';}

var dataMap=window.__bxappTiered||{};
Object.keys(dataMap).forEach(function(widgetId){
  var D=dataMap[widgetId];
  if(D._i)return;D._i=true;
  var widget=document.getElementById('bxgy-tiers-'+widgetId);
  if(!widget)return;

  var _t=D._track||{};
  bxTrack(_t,'view','tiered',_t.bundleId,_t.productId);

  var shopCurrency=D.currency;
  var hasMultipleVariants=D.hasMultipleVariants;
  var productOptions=D.productOptions||[];
  var allVariants=D.allVariants||[];
  var defaultVariantId=D.defaultVariantId;
  var defaultVariant=null;
  var buyVariants={};
  allVariants.forEach(function(v){buyVariants[v.id]=v;if(v.id===defaultVariantId)defaultVariant=v;});
  if(!defaultVariant)defaultVariant=allVariants[0];

  function findVariantByOpts(opts){
    for(var i=0;i<allVariants.length;i++){var v=allVariants[i],match=true;for(var j=0;j<opts.length;j++){if(opts[j]!=null&&v.options[j]!==opts[j]){match=false;break;}}if(match)return v;}return null;
  }

  var rows=widget.querySelectorAll('[data-bxgy-tier]');
  var addBtn=widget.querySelector('[data-bxgy-tiers-add-btn]');
  var feedbackEl=widget.querySelector('[data-bxgy-tiers-feedback]');
  var tierSelections={};

  var selectedTier=rows.length>1?1:0;
  for(var ri=0;ri<rows.length;ri++){if(rows[ri].classList.contains('bxgy-tiers__row--selected')){selectedTier=parseInt(rows[ri].getAttribute('data-bxgy-tier'),10);break;}}

  function formatMoney(cents){return new Intl.NumberFormat(undefined,{style:'currency',currency:shopCurrency||'USD'}).format(cents/100);}

  function getSelectedVariantId(){
    var p=new URLSearchParams(window.location.search);var v=p.get('variant');if(v&&buyVariants[v])return v;
    var input=document.querySelector('form[action*="/cart/add"] input[name="id"]');if(input&&input.value&&buyVariants[input.value])return input.value;
    var sel=document.querySelector('form[action*="/cart/add"] select[name="id"]');if(sel&&sel.value&&buyVariants[sel.value])return sel.value;
    var radio=document.querySelector('form[action*="/cart/add"] input[name="id"]:checked');if(radio&&radio.value&&buyVariants[radio.value])return radio.value;
    var keys=Object.keys(buyVariants);for(var i=0;i<keys.length;i++){if(buyVariants[keys[i]].available)return keys[i];}return keys[0]||null;
  }

  function buildTierVariants(tierIdx){
    var container=widget.querySelector('[data-bxgy-tier-tv="'+tierIdx+'"]');if(!container)return;
    var row=widget.querySelector('[data-bxgy-tier="'+tierIdx+'"]');
    var buyQty=parseInt(row.getAttribute('data-buy-qty'),10);var freeQty=parseInt(row.getAttribute('data-free-qty'),10);var totalQty=buyQty+freeQty;
    if(!tierSelections[tierIdx]){tierSelections[tierIdx]=[];for(var q=0;q<totalQty;q++){var opts=[];for(var o=0;o<productOptions.length;o++){opts.push(defaultVariant?defaultVariant.options[o]:productOptions[o].values[0]);}tierSelections[tierIdx].push({options:opts,variantId:defaultVariantId});}}
    var html='';var optNames=[];for(var oi=0;oi<productOptions.length;oi++)optNames.push(productOptions[oi].name);
    html+='<div class="bxgy-tiers__tv-header">'+optNames.join(', ')+'</div>';
    for(var item=0;item<totalQty;item++){
      var sel=tierSelections[tierIdx][item];
      html+='<div class="bxgy-tiers__tv-row"><span class="bxgy-tiers__tv-num">#'+(item+1)+'</span>';
      for(var opt=0;opt<productOptions.length;opt++){
        var po=productOptions[opt];var isColor=isColorOption(po.name);var currentVal=sel.options[opt];
        html+='<div class="bxgy-tiers__tv-opt">';
        if(isColor){var hex=getColorHex(currentVal);if(hex)html+='<span class="bxgy-tiers__tv-dot" style="background:'+hex+'"></span>';}
        html+='<select class="bxgy-tiers__tv-sel" data-tv-tier="'+tierIdx+'" data-tv-item="'+item+'" data-tv-opt="'+opt+'">';
        for(var vi=0;vi<po.values.length;vi++){var v=po.values[vi];html+='<option value="'+v.replace(/"/g,'&quot;')+'"'+(v===currentVal?' selected':'')+'>'+v+'</option>';}
        html+='</select></div>';
      }
      html+='</div>';
    }
    container.innerHTML=html;
    var selects=container.querySelectorAll('.bxgy-tiers__tv-sel');
    selects.forEach(function(sel){
      sel.addEventListener('click',function(e){e.stopPropagation();});
      sel.addEventListener('change',function(e){
        e.stopPropagation();var ti=parseInt(sel.getAttribute('data-tv-tier'),10);var ii=parseInt(sel.getAttribute('data-tv-item'),10);var oi2=parseInt(sel.getAttribute('data-tv-opt'),10);
        tierSelections[ti][ii].options[oi2]=sel.value;
        var variant=findVariantByOpts(tierSelections[ti][ii].options);tierSelections[ti][ii].variantId=variant?variant.id:null;
        if(isColorOption(productOptions[oi2].name)){
          var dot=sel.parentElement.querySelector('.bxgy-tiers__tv-dot');var hex=getColorHex(sel.value);
          if(dot){dot.style.background=hex||'transparent';dot.style.display=hex?'':'none';}
          else if(hex){var nd=document.createElement('span');nd.className='bxgy-tiers__tv-dot';nd.style.background=hex;sel.parentElement.insertBefore(nd,sel);}
        }
        updateTierPrices();
      });
    });
  }

  function updateTierVariantsVisibility(){
    if(!hasMultipleVariants)return;
    rows.forEach(function(row){
      var idx=row.getAttribute('data-bxgy-tier');var tv=widget.querySelector('[data-bxgy-tier-tv="'+idx+'"]');if(!tv)return;
      var isSelected=row.classList.contains('bxgy-tiers__row--selected');
      if(isSelected){buildTierVariants(parseInt(idx,10));tv.style.display='';}else{tv.style.display='none';}
    });
  }

  function getTierTotalPrice(tierIdx){
    var row=widget.querySelector('[data-bxgy-tier="'+tierIdx+'"]');
    var buyQty=parseInt(row.getAttribute('data-buy-qty'),10);var freeQty=parseInt(row.getAttribute('data-free-qty'),10);var totalQty=buyQty+freeQty;
    if(!hasMultipleVariants||!tierSelections[tierIdx]){var vid=getSelectedVariantId();return(vid&&buyVariants[vid]?buyVariants[vid].price:0)*totalQty;}
    var total=0;for(var i=0;i<totalQty;i++){var s=tierSelections[tierIdx][i];if(s&&s.variantId&&buyVariants[s.variantId])total+=buyVariants[s.variantId].price;else total+=defaultVariant?defaultVariant.price:0;}
    return total;
  }

  function updateTierPrices(){
    rows.forEach(function(row){
      var idx=parseInt(row.getAttribute('data-bxgy-tier'),10);
      var buyQty=parseInt(row.getAttribute('data-buy-qty'),10);var freeQty=parseInt(row.getAttribute('data-free-qty'),10);var discPct=parseInt(row.getAttribute('data-disc-pct'),10)||100;
      var totalPrice=getTierTotalPrice(idx);var totalQty=buyQty+freeQty;var perUnit=totalQty>0?totalPrice/totalQty:0;
      var freeItemsCost=Math.round(perUnit*freeQty);var savings=Math.round(freeItemsCost*discPct/100);var finalVal=totalPrice-savings;
      var finalEl=widget.querySelector('[data-bxgy-tier-final="'+idx+'"]');var origEl=widget.querySelector('[data-bxgy-tier-original="'+idx+'"]');
      if(finalEl)finalEl.textContent=formatMoney(finalVal);if(origEl)origEl.textContent=formatMoney(totalPrice);
    });
  }

  function selectTier(index){
    selectedTier=index;rows.forEach(function(row){var idx=parseInt(row.getAttribute('data-bxgy-tier'),10);row.classList.toggle('bxgy-tiers__row--selected',idx===index);});
    bxTrack(_t,'click','tiered',_t.bundleId,_t.productId);
    updateTierVariantsVisibility();updateTierPrices();
  }
  rows.forEach(function(row){row.addEventListener('click',function(){selectTier(parseInt(row.getAttribute('data-bxgy-tier'),10));});});

  var lastUrl=window.location.href;
  setInterval(function(){if(window.location.href!==lastUrl){lastUrl=window.location.href;updateTierPrices();}},500);
  var variantInput=document.querySelector('form[action*="/cart/add"] input[name="id"]');
  if(variantInput){new MutationObserver(function(){updateTierPrices();}).observe(variantInput,{attributes:true,attributeFilter:['value']});}
  var variantSelect=document.querySelector('form[action*="/cart/add"] select[name="id"]');
  if(variantSelect)variantSelect.addEventListener('change',function(){updateTierPrices();});
  document.addEventListener('variant:changed',function(){updateTierPrices();});

  function showFeedback(type,message){feedbackEl.textContent=message;feedbackEl.className='bxgy-tiers__feedback bxgy-tiers__feedback--'+type;if(type==='success')setTimeout(function(){feedbackEl.className='bxgy-tiers__feedback';},4000);}

  function refreshCart(){
    document.documentElement.dispatchEvent(new CustomEvent('cart:refresh',{bubbles:true}));
    fetch('/cart.js',{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(cart){document.querySelectorAll('.cart-count-bubble span, .cart-count, [data-cart-count], .js-cart-count, #cart-icon-bubble span').forEach(function(el){el.textContent=cart.item_count;});}).catch(function(){});
  }

  addBtn.addEventListener('click',function(){
    if(addBtn.disabled)return;
    var selectedRow=widget.querySelector('[data-bxgy-tier="'+selectedTier+'"]');if(!selectedRow)return;
    var buyQty=parseInt(selectedRow.getAttribute('data-buy-qty'),10);var freeQty=parseInt(selectedRow.getAttribute('data-free-qty'),10);var totalQty=buyQty+freeQty;var items=[];
    var bxProps={'_bxapp_bundle_type':'tiered','_bxapp_bundle_id':String(_t.bundleId||'')};
    if(hasMultipleVariants&&tierSelections[selectedTier]){
      var grouped={};for(var i=0;i<totalQty;i++){var s=tierSelections[selectedTier][i];var vid=s&&s.variantId?s.variantId:defaultVariantId;if(!vid){showFeedback('error','Please select a valid option for item #'+(i+1));return;}grouped[vid]=(grouped[vid]||0)+1;}
      Object.keys(grouped).forEach(function(vid){items.push({id:parseInt(vid,10),quantity:grouped[vid],properties:bxProps});});
    }else{var variantId=getSelectedVariantId();if(!variantId){showFeedback('error','Please select a product variant.');return;}items.push({id:parseInt(variantId,10),quantity:totalQty,properties:bxProps});}
    addBtn.disabled=true;addBtn.classList.add('bxgy-tiers__add-btn--loading');feedbackEl.className='bxgy-tiers__feedback';
    fetch('/cart/add.js',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({items:items})})
    .then(function(r){if(!r.ok)return r.json().then(function(d){throw new Error(d.description||d.message||'Failed to add to cart');});return r.json();})
    .then(function(){addBtn.disabled=false;addBtn.classList.remove('bxgy-tiers__add-btn--loading');showFeedback('success','Bundle added to cart!');bxTrack(_t,'add_to_cart','tiered',_t.bundleId,_t.productId);refreshCart();})
    .catch(function(err){addBtn.disabled=false;addBtn.classList.remove('bxgy-tiers__add-btn--loading');showFeedback('error',err.message||'Something went wrong. Please try again.');});
  });

  updateTierVariantsVisibility();
  updateTierPrices();
});
})();
