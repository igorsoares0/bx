(function(){
if(window.__bxappCart)return;
var cart={};

// Detect cart-related section IDs from the page DOM
cart.getSectionIds=function(){
  var ids=[],seen={};
  document.querySelectorAll('[id^="shopify-section-"]').forEach(function(el){
    var id=el.id.replace('shopify-section-','');
    if(/cart|bubble|drawer|notification|bag|basket|mini-cart/i.test(id)&&!seen[id]){seen[id]=true;ids.push(id);}
  });
  ['cart-icon-bubble','cart-drawer','cart-notification'].forEach(function(id){if(!seen[id])ids.push(id);});
  return ids.slice(0,5);
};

// Robust cart UI refresh: Section Rendering API + native notification + events + selectors
cart.refresh=function(data){
  var sectionsUpdated=false;

  // 1. Section Rendering: replace HTML from /cart/add.js response
  if(data&&data.sections){
    Object.keys(data.sections).forEach(function(id){
      var el=document.getElementById('shopify-section-'+id);
      if(el&&data.sections[id]){
        el.outerHTML=data.sections[id];
        sectionsUpdated=true;
        var newEl=document.getElementById('shopify-section-'+id);
        if(newEl)newEl.dispatchEvent(new CustomEvent('shopify:section:load',{bubbles:true,detail:{sectionId:id}}));
      }
    });
  }

  // 2. Dispatch events that themes commonly listen to
  ['cart:refresh','cart:updated','cart:build','ajaxProduct:added','product:added','cart:item-added'].forEach(function(name){
    document.documentElement.dispatchEvent(new CustomEvent(name,{bubbles:true}));
    document.dispatchEvent(new CustomEvent(name,{bubbles:true}));
  });

  // 3. Fetch /cart.js and update known cart count selectors
  fetch('/cart.js',{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(c){
    document.querySelectorAll(
      '.cart-count-bubble span,.cart-count,[data-cart-count],.js-cart-count,'+
      '#cart-icon-bubble span,.header__cart-count,.site-header__cart-count,'+
      '.cart-link__bubble,[data-cart-count-bubble] span,.cart-count-tag,'+
      '.CartCount,.js-cart-badge,.cart-items-count'
    ).forEach(function(el){el.textContent=c.item_count;});
    document.querySelectorAll('.cart-count-bubble,[data-cart-count-bubble],.cart-link__bubble').forEach(function(el){
      if(c.item_count>0){el.removeAttribute('hidden');el.style.display='';}
    });
  }).catch(function(){});

  // 4. Open theme's native cart notification/drawer
  // Wait for section re-render and custom element initialization to settle
  setTimeout(function(){
    // Dawn: <cart-notification> popup (like the "Item added to your cart" popup)
    var cn=document.querySelector('cart-notification');
    if(cn){
      cn.classList.add('active');
      cn.setAttribute('role','alert');
      cn.setAttribute('aria-live','polite');
      var focusEl=cn.querySelector('a,button');
      if(focusEl)focusEl.focus();
      return;
    }
    // Dawn: <cart-drawer> sidebar
    var cd=document.querySelector('cart-drawer');
    if(cd){
      if(typeof cd.open==='function'){cd.open();}
      else{cd.classList.add('active');cd.setAttribute('open','');}
      return;
    }
    // Prestige / Impact: [data-cart-notification] or [data-mini-cart]
    var pn=document.querySelector('[data-cart-notification]');
    if(pn){pn.classList.add('is-visible','active');return;}
    var mc=document.querySelector('[data-mini-cart]');
    if(mc){mc.classList.add('is-open','active');return;}
    // Debut / Supply / older themes: .cart-popup or .ajax-cart
    var cp=document.querySelector('.cart-popup,.ajax-cart,.mini-cart-wrap,.js-mini-cart');
    if(cp){cp.classList.add('active','is-active','is-open');return;}
  },200);
};

// Add items via AJAX with Section Rendering API
cart.addItems=function(items){
  var body={items:items};
  var sids=cart.getSectionIds();
  if(sids.length>0)body.sections=sids.join(',');
  return fetch('/cart/add.js',{
    method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json','Accept':'application/json'},
    body:JSON.stringify(body)
  }).then(function(r){
    if(!r.ok)return r.json().then(function(d){throw new Error(d.description||d.message||'Failed');});
    return r.json();
  }).then(function(data){
    cart.refresh(data);
    return data;
  });
};

// Submit via theme form for single-variant bundles (triggers native cart notification)
cart.submitViaThemeForm=function(qty,props){
  var form=document.querySelector('form[action*="/cart/add"]');
  if(!form)return false;
  var qtyInp=form.querySelector('input[name="quantity"]');
  if(!qtyInp){qtyInp=document.createElement('input');qtyInp.type='hidden';qtyInp.name='quantity';form.appendChild(qtyInp);}
  qtyInp.value=String(qty);
  form.querySelectorAll('input[name^="properties[_bxapp_"]').forEach(function(el){el.remove();});
  Object.keys(props).forEach(function(k){
    var h=document.createElement('input');h.type='hidden';h.name='properties['+k+']';h.value=props[k];form.appendChild(h);
  });
  if(form.requestSubmit){form.requestSubmit();}else{form.submit();}
  return true;
};

// ── Unified fetch interception (single monkey-patch) ──
cart._handlers=[];
cart.registerFetchHandler=function(fn){cart._handlers.push(fn);};
cart.removeFetchHandler=function(fn){var i=cart._handlers.indexOf(fn);if(i!==-1)cart._handlers.splice(i,1);};
var _orig=window.fetch;
window.fetch=function(url,opts){
  var urlStr=typeof url==='string'?url:(url&&url.url?url.url:'');
  for(var i=0;i<cart._handlers.length;i++){
    var result=cart._handlers[i](urlStr,opts);
    if(result)opts=result;
  }
  return _orig.call(window,url,opts);
};

window.__bxappCart=cart;
})();
