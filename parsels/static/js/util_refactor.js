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

String.prototype.capitalize = function() {
  return this.charAt(0).toUpperCase() + this.slice(1)
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


var dmatgm = {
  '0' : 'INDETERMINE',
'1' : 'PIERRE',
'2' : 'MEULIERE',
'3' : 'BETON',
'4' : 'BRIQUES',
'5' : 'AGGLOMERE',
'6' : 'BOIS',
'9' : 'AUTRES',
'0' : 'INDETERMINE',
'1' : 'PIERRE',
'2' : 'MEULIERE',
'3' : 'BETON',
'4' : 'BRIQUES',
'5' : 'AGGLOMERE',
'6' : 'BOIS',
'9' : 'AUTRES',
'10' : 'PIERRE',
'11' : 'PIERRE',
'12' : 'MEULIERE - PIERRE',
'13' : 'BETON - PIERRE',
'14' : 'BRIQUES - PIERRE',
'15' : 'AGGLOMERE - PIERRE',
'16' : 'BOIS - PIERRE',
'19' : 'PIERRE - AUTRES',
'20' : 'MEULIERE',
'21' : 'MEULIERE - PIERRE',
'22' : 'MEULIERE',
'23' : 'BETON - MEULIERE',
'24' : 'BRIQUES - MEULIERE',
'25' : 'AGGLOMERE - MEULIERE',
'26' : 'BOIS - MEULIERE',
'29' : 'MEULIERE - AUTRES',
'30' : 'BETON',
'31' : 'BETON - PIERRE',
'32' : 'BETON - MEULIERE',
'33' : 'BETON',
'34' : 'BETON - BRIQUES',
'35' : 'AGGLOMERE - BETON',
'36' : 'BETON - BOIS',
'39' : 'BETON - AUTRES',
'40' : 'BRIQUES',
'41' : 'BRIQUES - PIERRE',
'42' : 'BRIQUES - MEULIERE',
'43' : 'BETON - BRIQUES',
'44' : 'BRIQUES',
'45' : 'AGGLOMERE - BRIQUES',
'46' : 'BOIS - BRIQUES',
'49' : 'BRIQUES - AUTRES',
'50' : 'AGGLOMERE',
'51' : 'AGGLOMERE - PIERRE',
'52' : 'AGGLOMERE - MEULIERE',
'53' : 'AGGLOMERE - BETON',
'54' : 'AGGLOMERE - BRIQUES',
'55' : 'AGGLOMERE',
'56' : 'AGGLOMERE - BOIS',
'59' : 'AGGLOMERE - AUTRES',
'60' : 'BOIS',
'61' : 'BOIS - PIERRE',
'62' : 'BOIS - MEULIERE',
'63' : 'BETON - BOIS',
'64' : 'BOIS - BRIQUES',
'65' : 'AGGLOMERE - BOIS',
'66' : 'BOIS',
'69' : 'BOIS - AUTRES',
'90' : 'AUTRES',
'91' : 'PIERRE - AUTRES',
'92' : 'MEULIERE - AUTRES',
'93' : 'BETON - AUTRES',
'94' : 'BRIQUES - AUTRES',
'95' : 'AGGLOMERE - AUTRES',
'96' : 'BOIS - AUTRES',
'99' : 'AUTRES'
}


var dmatto =  {
  '0' : 'INDETERMINE',
  '1' : 'TUILES',
  '2' : 'ARDOISES',
  '3' : 'ZINC ALUMINIUM',
  '4' : 'BETON',
  '9' : 'AUTRES',
  '0' : 'INDETERMINE',
  '1' : 'TUILES',
  '2' : 'ARDOISES',
  '3' : 'ZINC ALUMINIUM',
  '4' : 'BETON',
  '9' : 'AUTRES',
  '10' : 'TUILES',
  '11' : 'TUILES',
  '12' : 'ARDOISES - TUILES',
  '13' : 'TUILES - ZINC ALUMINIUM',
  '14' : 'BETON - TUILES',
  '19' : 'TUILES - AUTRES',
  '20' : 'ARDOISES',
  '21' : 'ARDOISES - TUILES',
  '22' : 'ARDOISES',
  '23' : 'ARDOISES - ZINC ALUMINIUM',
  '24' : 'ARDOISES - BETON',
  '29' : 'ARDOISES - AUTRES',
  '30' : 'ZINC ALUMINIUM',
  '31' : 'TUILES - ZINC ALUMINIUM',
  '32' : 'ARDOISES - ZINC ALUMINIUM',
  '33' : 'ZINC ALUMINIUM',
  '34' : 'BETON - ZINC ALUMINIUM',
  '39' : 'ZINC ALUMINIUM - AUTRES',
  '40' : 'BETON',
  '41' : 'BETON - TUILES',
  '42' : 'ARDOISES - BETON',
  '43' : 'BETON - ZINC ALUMINIUM',
  '44' : 'BETON',
  '49' : 'BETON - AUTRES',
  '90' : 'AUTRES',
  '91' : 'TUILES - AUTRES',
  '92' : 'ARDOISES - AUTRES',
  '93' : 'ZINC ALUMINIUM - AUTRES',
  '94' : 'BETON - AUTRES',
  '99' : 'AUTRES'
}
