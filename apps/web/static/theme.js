try {
  var t = localStorage.getItem('pp:theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  var a = localStorage.getItem('pp:accent');
  if (a) {
    var s = JSON.parse(a);
    for (var k in s) document.documentElement.style.setProperty(k, s[k]);
  }
} catch (e) {}
