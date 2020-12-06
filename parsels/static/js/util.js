
Notiflix.Notify.Init({plainText:false,useGoogleFont:true,fontFamily:'Quicksand',messageMaxLength:500});
Notiflix.Report.Init({plainText:false,useGoogleFont:true,fontFamily:'Quicksand',messageMaxLength:500});



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
