var resultNote = "";
var serviceUrlQuery="../../gonggao/xxgk/doCpQuery";
//var serviceUrlQuery="../gonggao/xxgk/doCpQuery";
$(document).ready(function() {
    // do something here
    //alert("document inited.");
});


function gotoPageByInput(){
    v = parseInt($("#query_goto_page").val());
    if(isNaN(v) || (v < 1 || v > $("#query_page_count").val())){
        alert("请输入合法的页码参数!");
        return;
    }
    $("#query_page_num").val(v);
    setAndLoadResultTable();
}

function gotoPage(pageNum){
    $("#query_page_num").val(pageNum);
    //alert($("#query_page_num").val());
    setAndLoadResultTable();
}

function gotoLast(){
    if($("#query_page_num").val() == -1){
        $("#query_page_num").val($("#query_page_count").val()-1);
    }else{
        $("#query_page_num").val($("#query_page_num").val()-1);
    }
    //alert($("#query_page_num").val());
    setAndLoadResultTable();
}

function gotoNext(){
    $("#query_page_num").val(($("#query_page_num").val()-1)+2);
    //alert($("#query_page_num").val());
    setAndLoadResultTable();
}

function gotoEnd(){
    //$("#query_page_num").val(-1);
    $("#query_page_num").val($("#query_page_count").val());
    setAndLoadResultTable();
}

function setAndLoadResultTable(){


	loadQueryDataAndShow();
    
}

function doQuery(){
    //alert("doQuery called.");
    $("#query_qymc_q_val").val($("#query_qymc_input").val());
    $("#query_cpsb_q_val").val($("#query_cpsb_input").val());
    $("#query_clxh_q_val").val($("#query_clxh_input").val());
    $("#query_clmc_q_val").val($("#query_clmc_input").val());
    //$("#query_scdz_q_val").val($("#query_scdz_input").val());
    $("#query_pc_q_val").val($("#query_pc_input").val());
    
   //$("#query_cplb_q_val").val($("#query_cplb_input").val());
    //$("#query_cxtype_q_val").val($("input[name='query_cxtype_input']:checked").val());
    
    $("#query_page_num").val("1");
    loadQueryDataAndShow();
    //loadQueryResult();

}

function loadQueryDataAndShow(){
	$("#query_status").html("正在加载数据,请稍候...");
	$.ajax({
        type: "POST",
        url: serviceUrlQuery,
        data:{
            qymc:encodeURI($("#query_qymc_q_val").val()),
            pc:$("#query_pc_q_val").val(),
            cpsb:encodeURI($("#query_cpsb_q_val").val()),
            clxh:encodeURI($("#query_clxh_q_val").val()),
            clmc:encodeURI($("#query_clmc_q_val").val()),
            //scdz:encodeURI($("#query_scdz_q_val").val()),
            //cplb:$("#query_cplb_q_val").val(),
            //cxtype:$("#query_cxtype_q_val").val(),
            pageSize:10,
            pageNum: $("#query_page_num").val()
        },
        dataType: "json",
        success: function(data){
        	
            $("#query_qymc_input").val($("#query_qymc_q_val").val());
            $("#query_pc_input").val($("#query_pc_q_val").val());
            $("#query_cpsb_input").val($("#query_cpsb_q_val").val());
            $("#query_clxh_input").val($("#query_clxh_q_val").val());
            $("#query_clmc_input").val($("#query_clmc_q_val").val());
            //$("#query_scdz_input").val($("#query_scdz_q_val").val());
        	
            //$("#query_cplb_input").val($("#query_cplb_q_val").val());
            //$("#query_cxtype_input").val($("#query_cxtype_q_val").val());
            //$("input:radio[name=query_cxtype_input][value="+$("#query_cxtype_q_val").val()+"]").attr("checked",true)
            
            var resultTable = "";
            var foundData = false;
        	if(data.handleResult.respCode==200){
        		
        		if(typeof(data.cpList) == "undefined" ||  data.cpList==null || data.cpList.length == 0 ){//isNaN(data.cpList) ||
        			$("#query_status").html("没有查询到数据");
        		}else{
        			
        			$("#query_status").html("");
        			
            	    resultTable="<br>\r\n<table width='100%' border='0' cellpadding='0' cellspacing='0' class='query_result_table'>\r\n";
            		resultTable+="<tr>\r\n<td align='center'>序号</td><td align='center'>企业名称</td><td align='center'>中文品牌</td><td align='center'>车辆型号</td><td align='center'>车辆名称</td><td align='center'>批次</td><td align='center'>参数页</td>\r\n";
            		resultTable+="</tr>\r\n";
        			
        			//$("#query_status").html("一共找到"+data.cpList.length+"条数据");
            		for(var i=0;i<data.cpList.length;i++){
            			foundData = true;
            			resultTable+="<tr>\r\n";
            			resultTable+="<td align='center'>&nbsp;"+(i+1)+"</td>\r\n";
            			resultTable+="<td>&nbsp;"+data.cpList[i].qymc+"</td>\r\n";
            			resultTable+="<td>&nbsp;"+data.cpList[i].cpsb+"</td>\r\n";
            			resultTable+="<td>&nbsp;<a class='query_result_cph_link' href='javascript:queryCpData(\""+data.cpList[i].dataTag+"\",\""+data.cpList[i].cpid+"\",\""+data.cpList[i].gppc+"\")'  >"+data.cpList[i].clxh+"</a></td>\r\n";
            			resultTable+="<td>&nbsp;"+data.cpList[i].clmc+"</td>\r\n";
            			resultTable+="<td align='center'>&nbsp;"+parseInt(data.cpList[i].gppc)+"</td>\r\n";
            			resultTable+="<td align='center'>&nbsp;<a class='query_result_cph_link' href='javascript:queryCpParamPage(\""+data.cpList[i].dataTag+"\",\""+data.cpList[i].cpid+"\",\""+data.cpList[i].gppc+"\")'  >查看</a></td>\r\n";
            			resultTable+="</tr>\r\n";
            		}
            		resultTable+="</table><br>\r\n";
        		}

        		
        		//alert(resultTable);
        		
        		$("#query_result").html(resultTable);
        		
        		if(foundData == true){
            		var pageCtrlCt="<center>";
            		
            		if(data.countResult.totalPage == 1){
            			pageCtrlCt += "一共找到"+data.countResult.total+"条记录";
            		}else{
                		pageCtrlCt = "<input id='query_page_count' value='"+data.countResult.totalPage+"' type='hidden'>";
                		pageCtrlCt +="一共找到"+data.countResult.total+"条记录,每页最多显示"+data.countResult.pageSize+"条记录,共"+data.countResult.totalPage+"页&nbsp;&nbsp;&nbsp;&nbsp;";
                		pageCtrlCt += "<input id='query_goto_page' value='' size='3' type='text'>&nbsp;";
                		pageCtrlCt += "<a class='query_gotopage_link' href='javascript:gotoPageByInput()'>GO</a><br>";
                		
                		var startIndx = data.countResult.pageNum-10;
                		if(startIndx<1){
                			startIndx = 1;
                		}
                		var endIndx = data.countResult.pageNum+10;
                		if(endIndx > data.countResult.totalPage){
                			endIndx=data.countResult.totalPage;
                		}
                		
                		if(data.countResult.pageNum != 1){
                			pageCtrlCt +='<a class="query_result_link" href="javascript:gotoPage(1)">首页</a>&nbsp;<a class="query_result_link" href="javascript:gotoLast()">上一页</a>&nbsp;';
                		}
                		
                		for(var i=startIndx;i<=endIndx;i++){
                			if(data.countResult.pageNum == i){
                				pageCtrlCt +="<font class='query_result_now_page'>"+i+"</font>&nbsp;";
                			}else{
                				pageCtrlCt += "<a class='query_result_link' href='javascript:gotoPage("+i+")'>"+i+"</a>&nbsp;";
                			}
                		}
                		
                		if(data.countResult.pageNum != data.countResult.totalPage){
                			pageCtrlCt +='<a class="query_result_link" href="javascript:gotoNext()">下一页</a>&nbsp;<a class="query_result_link" href="javascript:gotoEnd()">末页</a>&nbsp;';
                		}
            		}
            		
            		pageCtrlCt +="</center>";
            		
            		$("#query_page_ctrl").html(pageCtrlCt);
     
        		}else{
        			$("#query_page_ctrl").html("");
        		}
        		
       		
        		//$("#query_status").html("一共找到"+data.cpList.length+"条数据");
        	}else{
        		// $("#query_status").html("查询失败:"+data.handleResult.digest);
						if (data.handleResult.digest.startsWith("Table")) {
						  $("#query_status").html("没有查询到数据");
						} else {
							$("#query_status").html("查询失败:"+data.handleResult.digest);
						}

        		$("#query_result").html("");
        		$("#query_page_ctrl").html("");
        	}
        }
    });
}


function queryCpData(dataTag,gid,pc){
	
	//alert(gid+":"+pc);
    //var newWin = window.open("../../gonggao/xxgk/queryCpData?dataTag="+dataTag+"&gid="+gid+"&pc="+pc, "win_"+gid+"_"+pc);
    //newWin.focus();
    
    window.open("../../gonggao/xxgk/queryCpData?dataTag="+dataTag+"&gid="+gid+"&pc="+pc);
    
}

function queryCpParamPage(dataTag,gid,pc){
	window.open("../../gonggao/xxgk/queryCpParamPage?dataTag="+dataTag+"&gid="+gid+"&pc="+pc);
}
