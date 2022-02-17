Notiflix.Notify.Init({plainText:false,useGoogleFont:true,fontFamily:'Sen',});
Notiflix.Report.Init({plainText:false,useGoogleFont:true,fontFamily:'Sen',});

function  number_format  (number, decimals, dec_point, thousands_sep) {
  number = number.toFixed(decimals);

  var nstr = number.toString();
  nstr += '';
  x = nstr.split('.');
  x1 = x[0];
  x2 = x.length > 1 ? dec_point + x[1] : '';
  var rgx = /(\d+)(\d{3})/;

  while (rgx.test(x1))
  x1 = x1.replace(rgx, '$1' + thousands_sep + '$2');

  return x1 + x2;
}

function contenance_format(number) {

  str = ""
  n_ha = Math.trunc( number / 10000 )
  number -= n_ha*10000;
  n_a = Math.trunc( number / 100 )
  number -= n_a*100;
  n_ca = Math.trunc(number)


  if (n_ha>0) {
    str += n_ha+" ha "
  }
  if (n_a>0) {
    str += n_a+" a "
  }
  if (n_ca>0) {
    str += n_ca+" ca"
  }
  return str
}

function format_batiment_id(id){
  return parseInt(id.replace('bBATIMENT',''))
}

function contenance_format_building(number) {
return Math.round(number) + ' m2'
}

var leafstyle_notactive = {
  fillColor: '#FFFFFF',
  weight: 2,
  opacity: 1,
  color: '#555',
  dashArray: '3',
  fillOpacity: 0.1
}

function styleNotActive(feature) {
  return {
    fillColor: '#FFFFFF',
    weight: 2,
    opacity: 1,
    color: 'var(--bs-strong)',
    dashArray: '3',
    fillOpacity: 0.0
  };
}
function styleActive(feature) {
  return {
    fillColor: 'var(--bs-teal)',
    weight: 5,
    opacity: 1,
    color: 'var(--bs-teal)',
    fillOpacity: 0.0
  };
}

  function styleSelected(feature) {
    return {
      fillColor: 'var(--bs-yellow)',
      weight: 5,
      opacity: 1,
      color: 'var(--bs-yellow)',
      fillOpacity: 0.5
    };
}


function styleBuildingStrong(feature) {
  return {
    fillColor: 'var(--bs-yellow)',
    weight: 2,
    opacity: 1,
    color: 'var(--bs-yellow)',
    fillOpacity: 0.5
  };
}

function styleBuildingLight(feature) {
  return {
    fillColor: 'var(--bs-yellow)',
    weight: 2,
    opacity: 1,
    color: 'var(--bs-yellow)',
    fillOpacity: 0.2
  };
}



function styleHighlighted(feature) {
  return {
    fillColor: 'var(--bs-yellow)',
    weight: 5,
    opacity: 1,
    color: 'var(--bs-yellow)',
    fillOpacity:  1
  };
}
