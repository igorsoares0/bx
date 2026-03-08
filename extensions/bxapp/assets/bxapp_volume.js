(function(){
var BXAPP_API_BASE=window.__bxappApiBase||'';
function bxTrack(t,ev,bt,bi,pi){try{var base=t.apiBase||BXAPP_API_BASE;if(!base)return;var url=base+'/api/analytics';fetch(url,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({shop:t.shop,eventType:ev,bundleType:bt,bundleId:bi||null,productId:pi||null}),keepalive:true,mode:'cors'}).catch(function(){});}catch(e){}}
var COLOR_MAP={'red':'#e53e3e','vermelho':'#e53e3e','blue':'#3182ce','azul':'#3182ce','green':'#38a169','verde':'#38a169','yellow':'#ecc94b','amarelo':'#ecc94b','black':'#1a202c','preto':'#1a202c','white':'#fff','branco':'#fff','pink':'#ed64a6','rosa':'#ed64a6','purple':'#805ad5','roxo':'#805ad5','orange':'#dd6b20','laranja':'#dd6b20','gray':'#a0aec0','grey':'#a0aec0','cinza':'#a0aec0','brown':'#8b6914','marrom':'#8b6914','navy':'#2a4365','marinho':'#2a4365','beige':'#f5f0e1','bege':'#f5f0e1','gold':'#d69e2e','dourado':'#d69e2e','silver':'#cbd5e0','prata':'#cbd5e0','coral':'#fc8181','turquoise':'#38b2ac','turquesa':'#38b2ac','wine':'#722f37','vinho':'#722f37','cream':'#fffdd0','creme':'#fffdd0','sky blue':'#63b3ed','azul claro':'#63b3ed','dark green':'#276749','verde escuro':'#276749','light blue':'#90cdf4','light green':'#9ae6b4','dark blue':'#2b6cb0','azul escuro':'#2b6cb0'};
function getColorHex(name){return name?COLOR_MAP[name.toLowerCase().trim()]||null:null;}
function isColorOption(n){var l=n.toLowerCase();return l==='cor'||l==='color'||l==='colour'||l==='cor/color';}

var dataMap=window.__bxappVolume||{};
Object.keys(dataMap).forEach(function(widgetId){
  var D=dataMap[widgetId];
  if(D._i)return;D._i=true;
  var widget=document.getElementById('bxgy-volume-'+widgetId);
  if(!widget)return;

  var _t=D._track||{};
  bxTrack(_t,'view','volume',_t.bundleId,_t.productId);

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

  var rows=widget.querySelectorAll('[data-bxgy-vol-tier]');
  var addBtn=widget.querySelector('[data-bxgy-vol-add-btn]');
  var feedbackEl=widget.querySelector('[data-bxgy-vol-feedback]');
  var tierSelections={};

  var selectedTier=0;
  for(var ri=0;ri<rows.length;ri++){if(rows[ri].classList.contains('bxgy-volume__row--selected')){selectedTier=parseInt(rows[ri].getAttribute('data-bxgy-vol-tier'),10);break;}}

  function formatMoney(cents){return new Intl.NumberFormat(undefined,{style:'currency',currency:shopCurrency||'USD'}).format(cents/100);}

  function buildTierVariants(tierIdx){
    var container=widget.querySelector('[data-bxgy-vol-tv="'+tierIdx+'"]');if(!container)return;
    var row=widget.querySelector('[data-bxgy-vol-tier="'+tierIdx+'"]');var qty=parseInt(row.getAttribute('data-vol-qty'),10);
    if(!tierSelections[tierIdx]){tierSelections[tierIdx]=[];for(var q=0;q<qty;q++){var opts=[];for(var o=0;o<productOptions.length;o++){opts.push(defaultVariant?defaultVariant.options[o]:productOptions[o].values[0]);}tierSelections[tierIdx].push({options:opts,variantId:defaultVariantId});}}
    var html='';var optNames=[];for(var oi=0;oi<productOptions.length;oi++)optNames.push(productOptions[oi].name);
    html+='<div class="bxgy-volume__tv-header">'+optNames.join(', ')+'</div>';
    for(var item=0;item<qty;item++){
      var sel=tierSelections[tierIdx][item];
      html+='<div class="bxgy-volume__tv-row"><span class="bxgy-volume__tv-num">#'+(item+1)+'</span>';
      for(var opt=0;opt<productOptions.length;opt++){
        var po=productOptions[opt];var isColor=isColorOption(po.name);var currentVal=sel.options[opt];
        html+='<div class="bxgy-volume__tv-opt">';
        if(isColor){var hex=getColorHex(currentVal);if(hex)html+='<span class="bxgy-volume__tv-dot" style="background:'+hex+'"></span>';}
        html+='<select class="bxgy-volume__tv-sel" data-tv-tier="'+tierIdx+'" data-tv-item="'+item+'" data-tv-opt="'+opt+'">';
        for(var vi=0;vi<po.values.length;vi++){var v=po.values[vi];html+='<option value="'+v.replace(/"/g,'&quot;')+'"'+(v===currentVal?' selected':'')+'>'+v+'</option>';}
        html+='</select></div>';
      }
      html+='</div>';
    }
    container.innerHTML=html;
    var selects=container.querySelectorAll('.bxgy-volume__tv-sel');
    selects.forEach(function(sel){
      sel.addEventListener('click',function(e){e.stopPropagation();});
      sel.addEventListener('change',function(e){
        e.stopPropagation();var ti=parseInt(sel.getAttribute('data-tv-tier'),10);var ii=parseInt(sel.getAttribute('data-tv-item'),10);var oi2=parseInt(sel.getAttribute('data-tv-opt'),10);
        tierSelections[ti][ii].options[oi2]=sel.value;
        var variant=findVariantByOpts(tierSelections[ti][ii].options);tierSelections[ti][ii].variantId=variant?variant.id:null;
        if(isColorOption(productOptions[oi2].name)){
          var dot=sel.parentElement.querySelector('.bxgy-volume__tv-dot');var hex=getColorHex(sel.value);
          if(dot){dot.style.background=hex||'transparent';dot.style.display=hex?'':'none';}
          else if(hex){var nd=document.createElement('span');nd.className='bxgy-volume__tv-dot';nd.style.background=hex;sel.parentElement.insertBefore(nd,sel);}
        }
        updateVolumePrices();
      });
    });
  }

  function updateTierVariantsVisibility(){
    if(!hasMultipleVariants)return;
    rows.forEach(function(row){
      var idx=row.getAttribute('data-bxgy-vol-tier');var tv=widget.querySelector('[data-bxgy-vol-tv="'+idx+'"]');if(!tv)return;
      var isSelected=row.classList.contains('bxgy-volume__row--selected');
      if(isSelected){buildTierVariants(parseInt(idx,10));tv.style.display='';}else{tv.style.display='none';}
    });
  }

  function getTierTotalPrice(tierIdx){
    var row=widget.querySelector('[data-bxgy-vol-tier="'+tierIdx+'"]');var qty=parseInt(row.getAttribute('data-vol-qty'),10);
    if(!hasMultipleVariants||!tierSelections[tierIdx]){
      var vid=defaultVariantId;var p=new URLSearchParams(window.location.search);var uv=p.get('variant');if(uv&&buyVariants[uv])vid=uv;
      var input=document.querySelector('form[action*="/cart/add"] input[name="id"]');if(input&&input.value&&buyVariants[input.value])vid=input.value;
      return(buyVariants[vid]?buyVariants[vid].price:0)*qty;
    }
    var total=0;for(var i=0;i<qty;i++){var s=tierSelections[tierIdx][i];if(s&&s.variantId&&buyVariants[s.variantId])total+=buyVariants[s.variantId].price;else total+=defaultVariant?defaultVariant.price:0;}
    return total;
  }

  function updateVolumePrices(){
    rows.forEach(function(row){
      var idx=parseInt(row.getAttribute('data-bxgy-vol-tier'),10);var disc=parseInt(row.getAttribute('data-vol-disc'),10)||0;
      var original=getTierTotalPrice(idx);var saveAmount=Math.round(original*disc/100);var finalVal=original-saveAmount;
      var finalEl=widget.querySelector('[data-bxgy-vol-final="'+idx+'"]');var origEl=widget.querySelector('[data-bxgy-vol-original="'+idx+'"]');var saveEl=widget.querySelector('[data-bxgy-vol-save="'+idx+'"]');
      if(finalEl)finalEl.textContent=formatMoney(finalVal);
      if(origEl){origEl.textContent=formatMoney(original);origEl.style.display=disc>0?'':'none';}
      if(saveEl){saveEl.textContent='SAVE '+formatMoney(saveAmount);saveEl.style.display=disc>0?'':'none';}
    });
  }

  function selectTier(index){
    selectedTier=index;rows.forEach(function(row){var idx=parseInt(row.getAttribute('data-bxgy-vol-tier'),10);row.classList.toggle('bxgy-volume__row--selected',idx===index);});
    bxTrack(_t,'click','volume',_t.bundleId,_t.productId);
    updateTierVariantsVisibility();updateVolumePrices();
  }
  rows.forEach(function(row){row.addEventListener('click',function(){selectTier(parseInt(row.getAttribute('data-bxgy-vol-tier'),10));});});

  var lastUrl=window.location.href;
  setInterval(function(){if(window.location.href!==lastUrl){lastUrl=window.location.href;updateVolumePrices();}},500);
  var formVariantInput=document.querySelector('form[action*="/cart/add"] input[name="id"]');
  if(formVariantInput){new MutationObserver(function(){updateVolumePrices();}).observe(formVariantInput,{attributes:true,attributeFilter:['value']});}
  var formVariantSelect=document.querySelector('form[action*="/cart/add"] select[name="id"]');
  if(formVariantSelect)formVariantSelect.addEventListener('change',function(){updateVolumePrices();});
  document.addEventListener('variant:changed',function(){updateVolumePrices();});

  function showFeedback(type,message){feedbackEl.textContent=message;feedbackEl.className='bxgy-volume__feedback bxgy-volume__feedback--'+type;if(type==='success')setTimeout(function(){feedbackEl.className='bxgy-volume__feedback';},4000);}

  function refreshCart(){
    document.documentElement.dispatchEvent(new CustomEvent('cart:refresh',{bubbles:true}));
    fetch('/cart.js',{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(cart){document.querySelectorAll('.cart-count-bubble span, .cart-count, [data-cart-count], .js-cart-count, #cart-icon-bubble span').forEach(function(el){el.textContent=cart.item_count;});}).catch(function(){});
  }

  // ── Native button mode: intercept theme's add-to-cart form ──
  if(D.useNativeButton){
    var nativeForm=document.querySelector('form[action*="/cart/add"]');
    if(nativeForm){
      var bxVolProps={'_bxapp_bundle_type':'volume','_bxapp_bundle_id':String(_t.bundleId||'')};

      function getVolQty(){
        var r=widget.querySelector('[data-bxgy-vol-tier="'+selectedTier+'"]');
        return r?parseInt(r.getAttribute('data-vol-qty'),10)||1:1;
      }

      function ensureQtyInput(){
        var inp=nativeForm.querySelector('input[name="quantity"]');
        if(!inp){inp=document.createElement('input');inp.type='hidden';inp.name='quantity';nativeForm.appendChild(inp);}
        return inp;
      }

      function syncNativeQty(){
        var inp=ensureQtyInput();
        inp.value=getVolQty();
      }

      function injectProps(){
        nativeForm.querySelectorAll('input[name^="properties[_bxapp_"]').forEach(function(el){el.remove();});
        Object.keys(bxVolProps).forEach(function(k){
          var h=document.createElement('input');h.type='hidden';h.name='properties['+k+']';h.value=bxVolProps[k];
          nativeForm.appendChild(h);
        });
      }

      // Use a shared flag so only the last-interacted bundle controls the native form
      window.__bxappNativeOwner=window.__bxappNativeOwner||null;
      function claimNative(){window.__bxappNativeOwner='volume_'+widgetId;syncNativeQty();injectProps();}

      // Claim on any tier click
      var origSelectTier=selectTier;
      selectTier=function(index){origSelectTier(index);claimNative();};
      // Initial claim (last widget to init wins by default)
      claimNative();

      nativeForm.addEventListener('submit',function(){
        if(window.__bxappNativeOwner==='volume_'+widgetId){syncNativeQty();injectProps();bxTrack(_t,'add_to_cart','volume',_t.bundleId,_t.productId);}
      },true);

      // Intercept fetch — only if this bundle owns the native form
      var origFetch=window.fetch;
      window.fetch=function(url,opts){
        if(typeof url==='string'&&url.indexOf('/cart/add')!==-1&&opts&&opts.body&&window.__bxappNativeOwner==='volume_'+widgetId){
          var qty=getVolQty();
          try{
            if(typeof opts.body==='string'){
              var body=JSON.parse(opts.body);
              var already=false;
              if(body.items){body.items.forEach(function(item){if(item.properties&&item.properties._bxapp_bundle_type)already=true;});}
              else if(body.properties&&body.properties._bxapp_bundle_type)already=true;
              if(!already){
                if(body.items){body.items.forEach(function(item){item.quantity=qty;item.properties=Object.assign({},item.properties||{},bxVolProps);});}
                else{body.quantity=qty;body.properties=Object.assign({},body.properties||{},bxVolProps);}
                opts=Object.assign({},opts,{body:JSON.stringify(body)});
              }
            }else if(opts.body instanceof FormData){
              if(!opts.body.get('properties[_bxapp_bundle_type]')){
                opts.body.set('quantity',String(qty));
                Object.keys(bxVolProps).forEach(function(k){opts.body.set('properties['+k+']',bxVolProps[k]);});
              }
            }
          }catch(ex){}
        }
        return origFetch.call(window,url,opts);
      };
    }
  }

  if(addBtn)addBtn.addEventListener('click',function(){
    if(addBtn.disabled)return;
    var selectedRow=widget.querySelector('[data-bxgy-vol-tier="'+selectedTier+'"]');if(!selectedRow)return;
    var qty=parseInt(selectedRow.getAttribute('data-vol-qty'),10);var items=[];
    var bxProps={'_bxapp_bundle_type':'volume','_bxapp_bundle_id':String(_t.bundleId||'')};
    if(hasMultipleVariants&&tierSelections[selectedTier]){
      var grouped={};for(var i=0;i<qty;i++){var s=tierSelections[selectedTier][i];var vid=s&&s.variantId?s.variantId:defaultVariantId;if(!vid){showFeedback('error','Please select a valid option for item #'+(i+1));return;}grouped[vid]=(grouped[vid]||0)+1;}
      Object.keys(grouped).forEach(function(vid){items.push({id:parseInt(vid,10),quantity:grouped[vid],properties:bxProps});});
    }else{
      var vid2=defaultVariantId;var p=new URLSearchParams(window.location.search);var uv=p.get('variant');if(uv&&buyVariants[uv])vid2=uv;
      var input=document.querySelector('form[action*="/cart/add"] input[name="id"]');if(input&&input.value&&buyVariants[input.value])vid2=input.value;
      if(!vid2){showFeedback('error','Please select a product variant.');return;}items.push({id:parseInt(vid2,10),quantity:qty,properties:bxProps});
    }
    addBtn.disabled=true;addBtn.classList.add('bxgy-volume__add-btn--loading');feedbackEl.className='bxgy-volume__feedback';
    fetch('/cart/add.js',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({items:items})})
    .then(function(r){if(!r.ok)return r.json().then(function(d){throw new Error(d.description||d.message||'Failed to add to cart');});return r.json();})
    .then(function(){addBtn.disabled=false;addBtn.classList.remove('bxgy-volume__add-btn--loading');bxTrack(_t,'add_to_cart','volume',_t.bundleId,_t.productId);if(D.buttonAction==='checkout'){window.location.href='/checkout';}else{showFeedback('success','Added to cart!');refreshCart();}})
    .catch(function(err){addBtn.disabled=false;addBtn.classList.remove('bxgy-volume__add-btn--loading');showFeedback('error',err.message||'Something went wrong. Please try again.');});
  });

  updateTierVariantsVisibility();
  updateVolumePrices();
});
})();
