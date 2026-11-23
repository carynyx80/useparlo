// SPDX-License-Identifier: GPL-3.0
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity >=0.7.0 <0.9.0;

contract CloseVerifier {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 13625396899357315085639770978400952225869810589539142681273501771785032784900;
    uint256 constant alphay  = 17341106240680696946716983975451652533737698356400448000888155428964785293616;
    uint256 constant betax1  = 21054681086353715063492117500288046701367445187435004394313502520130203663985;
    uint256 constant betax2  = 6636167216334388913530613104088784134669822667513555876814421376881635621655;
    uint256 constant betay1  = 14902111641379552464837249574664141535990264200269713757251896878678731971671;
    uint256 constant betay2  = 17527692364418013767667144220980767255715489432684122267901672982893786732629;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 2975368735289311622212199424098007319288912767354989876378392204335336060141;
    uint256 constant deltax2 = 2946065448100702730460003226233795266059097417081825681746735968387994579383;
    uint256 constant deltay1 = 17088962968940468244818905977813520962211892891539376101551116091120038893898;
    uint256 constant deltay2 = 6873423166291509802793420556582815787493468095691823830548807925780530501397;

    
    uint256 constant IC0x = 6755227229814439626560505028536656564505493849327703550834293167848417925346;
    uint256 constant IC0y = 21256010982069984619032592324605028544166867009518006356192945643586959884720;
    
    uint256 constant IC1x = 12762205384720184244474591111759784061230572028876484736667497893808862060167;
    uint256 constant IC1y = 393309893950563371466556030752055941295457451875082150252388334327082985815;
    
    uint256 constant IC2x = 11334825955405678502691106276055540378595400621296461454359874017269646707577;
    uint256 constant IC2y = 15323756351387514204292732986058528274714231188840084605923619322287112660927;
    
    uint256 constant IC3x = 5839448199314998177679907127692742596759925667995627896462330407242032548626;
    uint256 constant IC3y = 9237011989634889774985851502847053919518356080132207974612893713886123648114;
    
    uint256 constant IC4x = 16727327712169570027129663034069019841427810517422041687747068578734683393236;
    uint256 constant IC4y = 1761869664692916241482822845990322493525576143623615358393091124568095510484;
    
    uint256 constant IC5x = 5632809136985361815041609343514061506084202094700021564479060308952089258449;
    uint256 constant IC5y = 5130872903755231193503205339609950128982517050397991807517188011603714580134;
    
    uint256 constant IC6x = 20093950387683279567823433798597189407405445654781815881463871266599880807219;
    uint256 constant IC6y = 12524349712540014422203917037810568314817444621377350842134944339991334371475;
    
    uint256 constant IC7x = 17513512516249410993346472919273217607420938834933536177209890763382030674113;
    uint256 constant IC7y = 433925143045837534171929039241509112049536536403251086630763120651334330594;
    
    uint256 constant IC8x = 3123645477271898562346331805618250815647324267666778612286117480638065095826;
    uint256 constant IC8y = 19118052752929148115151355898787742108194927500217106286347456977115217317359;
    
    uint256 constant IC9x = 16529662878305276481932467359517427817809026193281394291563336858139587137546;
    uint256 constant IC9y = 14343679021049684939515670578505049747362426098245923857052001227640747055566;
    
    uint256 constant IC10x = 3977409309465330072405223426836635731220396675667959856129981624839235055570;
    uint256 constant IC10y = 4028701376092651105907243998158189550606324779099060105919260973982028376701;
    
    uint256 constant IC11x = 6144079138993433125343126707129558847622612936104385187804827313096050815810;
    uint256 constant IC11y = 17153210777752001831417160879905655629465525997067324854289778355317745280026;
    
    uint256 constant IC12x = 17214940739666336084770431478755070768543953202998653200690383894832782982407;
    uint256 constant IC12y = 396551431520648537289856196036273374117159234761385710593922608146150229684;
    
    uint256 constant IC13x = 2303895181454047871107608220575263409181795124060845130837300799025328530300;
    uint256 constant IC13y = 19499445259665634969149352501148865481763648666555730926363598424809784679799;
    
    uint256 constant IC14x = 11182917884647239981823417012920243748730166211079769097992774793550225649597;
    uint256 constant IC14y = 5766429045122577299199203317831992510294547655548592017264018203402160942982;
    
    uint256 constant IC15x = 10234091928618414753841279434689342199871684956658770951136802284386580771198;
    uint256 constant IC15y = 20600839422195375533975495723708835945647799383657410923901769882514468700277;
    
    uint256 constant IC16x = 7661079833849189708163890732921310079731886281564073605912985996680316614302;
    uint256 constant IC16y = 16536656441264263179079618459199811342743747490356335314978797204315972194562;
    
    uint256 constant IC17x = 21876441389257248714969628072124045291763052761241443757761297307754808173450;
    uint256 constant IC17y = 14955748223330619397421814421927173477591299698607723107237656043783092756504;
    
    uint256 constant IC18x = 13454946710401360397522823879600175809236053105275843067721273329973160155903;
    uint256 constant IC18y = 16285144468465326805423688547775890158339390699972957726298688283784944967803;
    
    uint256 constant IC19x = 2882239294413253709842214741313060330160904170412223111833157781055265643853;
    uint256 constant IC19y = 16956250698393635505991723709070065469715234857327234878754569720347446853584;
    
    uint256 constant IC20x = 11642214306893882057817052272983490919411132631946058174378023704287501400376;
    uint256 constant IC20y = 21801389435118537622322392913437871660175530190277289470310072585189940040044;
    
    uint256 constant IC21x = 14554354451889665011227836612805331818414393742225551581161633321671681253207;
    uint256 constant IC21y = 2419768991267315508007987061298969135844730108882631518308731573663189497949;
    
    uint256 constant IC22x = 21249414872688360793350765443417135302544653707635184645026020483415765139329;
    uint256 constant IC22y = 14297649040240848376325273530951421300034405759614896659836725127213315601755;
    
    uint256 constant IC23x = 15697666049377215786524008563202531948970493224726836984764572516191325970837;
    uint256 constant IC23y = 7659687698792779641850814894524350193064631997931980717910850238912732094445;
    
    uint256 constant IC24x = 14164197446755523148100475601347987097503907242388720631495491266796450810897;
    uint256 constant IC24y = 15321259506404348835704894246733528572682437540808716014177493031552350994773;
    
    uint256 constant IC25x = 19731016445900362623402567722822782038781389952826409417416004184981607591630;
    uint256 constant IC25y = 8822157359952923219688057655431504229713349871481603870425747011078591678073;
    
    uint256 constant IC26x = 21407738214542130454247922479858561644124223459626785365726267358229489456583;
    uint256 constant IC26y = 21396316263612701488145146816930417710656681187099018852728545605731031795203;
    
    uint256 constant IC27x = 16397325375966211816125838945729781548195954113879081736574894683529370985295;
    uint256 constant IC27y = 1315448405756566786104131948683473382666067315557059140528393539741783363536;
    
    uint256 constant IC28x = 10312647430939257286935931253656239410777449790398552964628942725325182115761;
    uint256 constant IC28y = 12982865167094605672167476391283313530073086288522286028078346115174617330589;
    
    uint256 constant IC29x = 8520329399035050956421370927905456542169986109639957717358158363756474564430;
    uint256 constant IC29y = 6963770725968897635870990988443173149550730724542905497922217141193916473138;
    
    uint256 constant IC30x = 20964485488301143810050458962269377169837389923774143508848935561533199058700;
    uint256 constant IC30y = 12016484365478270372278714889595362311014327378626115968684763445371922867047;
    
    uint256 constant IC31x = 14470719560627020178843768839368054016206521576400105759548574599978177367609;
    uint256 constant IC31y = 21635110313679343076195479806823860831439723090656382480672713774771721123041;
    
    uint256 constant IC32x = 20595451073970812829419115687687596839911767281954577456498141526457260390869;
    uint256 constant IC32y = 169079680032603286218618414462666821078725102627545993929393935388101603650;
    
    uint256 constant IC33x = 9880331811370733763897556982014878760300728666966634600815558444780689108845;
    uint256 constant IC33y = 11677264849015902492849754586123633045884727425489324468956465852523594135727;
    
    uint256 constant IC34x = 21055068031152881790371177240548203472260849208859182037226233218480622544568;
    uint256 constant IC34y = 8072236440207294387919618383216577903587206411029188936116580973850921078414;
    
    uint256 constant IC35x = 20245404353234168242643452130880545610350678544239694975800204213598275444316;
    uint256 constant IC35y = 11279990263616272701093365093854173663110907379776092331653922841039798568266;
    
    uint256 constant IC36x = 11578036598313257659680368581580169392497947127909874550239121177268862357235;
    uint256 constant IC36y = 7377712450656331760210254198060023283542546648385426121203959288035523769043;
    
    uint256 constant IC37x = 13233516051732328806617306850905625205764474023368223895521100832994346458290;
    uint256 constant IC37y = 2481743688973014345104689421298286590248538269443117101746845948513330274166;
    
    uint256 constant IC38x = 15240980777118892829424867520119237792609761062883837544038368771352652276365;
    uint256 constant IC38y = 2423237295528154327031989673897762821772581016406869253018991193511355059139;
    
    uint256 constant IC39x = 6946885235122873407383274914967524050285109175733549533270305446399984136787;
    uint256 constant IC39y = 4495011205685349249871356815965831841939087629124954334636792656914323682602;
    
    uint256 constant IC40x = 17766034299349982134890504111283015987130631534889572880604182916658451872687;
    uint256 constant IC40y = 16709036690960700177816630879682769781171164367128040124638640533737131924380;
    
    uint256 constant IC41x = 8481463105464906227203088440851697895840326392489196133405202790838678927887;
    uint256 constant IC41y = 21461547977690679628756591535605677082952808064415371219064025209252361299966;
    
    uint256 constant IC42x = 4958338732519518992909670459550020830264315962548338669787192968605446571874;
    uint256 constant IC42y = 7778952938121910480395438364158291587912798362068349409521884729444766535716;
    
    uint256 constant IC43x = 3559877119261807635439609917281304684041004518807705774222546236583473574417;
    uint256 constant IC43y = 19362664969369649767008878461786521653292298030867686175969795074154092682916;
    
    uint256 constant IC44x = 11032190459968198815168226567488323004465925927757195870717244882592926635926;
    uint256 constant IC44y = 13687881307046276626936052413960036629359973347798781318829094826801071051403;
    
    uint256 constant IC45x = 18582031301014738128644765828895247357801387976582537391105267370606083178937;
    uint256 constant IC45y = 3071766346856282174431990493017332472157029487916003403346908146001045747168;
    
    uint256 constant IC46x = 11054626098953065854658013537259516135962759029959454499882236941860852505514;
    uint256 constant IC46y = 13011702335851026639794563837224316059799814273911106285746049860609926849048;
    
    uint256 constant IC47x = 966927534692901669337224762611785948664674839794893545583272434571766647700;
    uint256 constant IC47y = 16449126029898627495913891800377416192882492081160168113618183433294189361200;
    
    uint256 constant IC48x = 9810863611985673393118392621183073106160423342930224700690257461036480218275;
    uint256 constant IC48y = 10760848548041986242496845368237218733224695035421950420430505245361746033724;
    
    uint256 constant IC49x = 19313098615646178289509102496853122185503840395355864619345568628651934320068;
    uint256 constant IC49y = 7538233558551497481219950658809872725025739989819734682620699279319255759025;
    
    uint256 constant IC50x = 20540780955285949128079342412291464782897151755639501819469413097843644502410;
    uint256 constant IC50y = 2009998322452757171930811539175236964287426482283125345100228953750830479828;
    
    uint256 constant IC51x = 13845796341518642605882552586689545025837019812013087327231624177536786987469;
    uint256 constant IC51y = 7511616438322414387967123685882736470398876893205510118785722962112383449879;
    
    uint256 constant IC52x = 12485756978967901748413564850417891436259216997779228834428900301332786474865;
    uint256 constant IC52y = 39829525289704563436806537961986868867908619873989279573509746462502091291;
    
    uint256 constant IC53x = 21081143607804776764155668646954940064544372336203187497300810256254572551372;
    uint256 constant IC53y = 9100861838365895119079526861441961977178273714391316903780427303324049412286;
    
    uint256 constant IC54x = 3998704623878398684684749409567075521776749445525130941414231767811046841438;
    uint256 constant IC54y = 19643513825062160425406360949528376774806533430670387852790897064388874949291;
    
    uint256 constant IC55x = 21356360909691567130665104796113697836982908573580325802666628289974546675971;
    uint256 constant IC55y = 9156952268024700605372341281852893561202332851557245284300214455469511278254;
    
    uint256 constant IC56x = 11869714422872260717699101464138046548421232955753088590401456071357670353606;
    uint256 constant IC56y = 16629230936272428648588201670846911609769831029648698078095374113750684181965;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[56] calldata _pubSignals) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }
            
            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x
                
                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))
                
                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))
                
                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))
                
                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))
                
                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))
                
                g1_mulAccC(_pVk, IC6x, IC6y, calldataload(add(pubSignals, 160)))
                
                g1_mulAccC(_pVk, IC7x, IC7y, calldataload(add(pubSignals, 192)))
                
                g1_mulAccC(_pVk, IC8x, IC8y, calldataload(add(pubSignals, 224)))
                
                g1_mulAccC(_pVk, IC9x, IC9y, calldataload(add(pubSignals, 256)))
                
                g1_mulAccC(_pVk, IC10x, IC10y, calldataload(add(pubSignals, 288)))
                
                g1_mulAccC(_pVk, IC11x, IC11y, calldataload(add(pubSignals, 320)))
                
                g1_mulAccC(_pVk, IC12x, IC12y, calldataload(add(pubSignals, 352)))
                
                g1_mulAccC(_pVk, IC13x, IC13y, calldataload(add(pubSignals, 384)))
                
                g1_mulAccC(_pVk, IC14x, IC14y, calldataload(add(pubSignals, 416)))
                
                g1_mulAccC(_pVk, IC15x, IC15y, calldataload(add(pubSignals, 448)))
                
                g1_mulAccC(_pVk, IC16x, IC16y, calldataload(add(pubSignals, 480)))
                
                g1_mulAccC(_pVk, IC17x, IC17y, calldataload(add(pubSignals, 512)))
                
                g1_mulAccC(_pVk, IC18x, IC18y, calldataload(add(pubSignals, 544)))
                
                g1_mulAccC(_pVk, IC19x, IC19y, calldataload(add(pubSignals, 576)))
                
                g1_mulAccC(_pVk, IC20x, IC20y, calldataload(add(pubSignals, 608)))
                
                g1_mulAccC(_pVk, IC21x, IC21y, calldataload(add(pubSignals, 640)))
                
                g1_mulAccC(_pVk, IC22x, IC22y, calldataload(add(pubSignals, 672)))
                
                g1_mulAccC(_pVk, IC23x, IC23y, calldataload(add(pubSignals, 704)))
                
                g1_mulAccC(_pVk, IC24x, IC24y, calldataload(add(pubSignals, 736)))
                
                g1_mulAccC(_pVk, IC25x, IC25y, calldataload(add(pubSignals, 768)))
                
                g1_mulAccC(_pVk, IC26x, IC26y, calldataload(add(pubSignals, 800)))
                
                g1_mulAccC(_pVk, IC27x, IC27y, calldataload(add(pubSignals, 832)))
                
                g1_mulAccC(_pVk, IC28x, IC28y, calldataload(add(pubSignals, 864)))
                
                g1_mulAccC(_pVk, IC29x, IC29y, calldataload(add(pubSignals, 896)))
                
                g1_mulAccC(_pVk, IC30x, IC30y, calldataload(add(pubSignals, 928)))
                
                g1_mulAccC(_pVk, IC31x, IC31y, calldataload(add(pubSignals, 960)))
                
                g1_mulAccC(_pVk, IC32x, IC32y, calldataload(add(pubSignals, 992)))
                
                g1_mulAccC(_pVk, IC33x, IC33y, calldataload(add(pubSignals, 1024)))
                
                g1_mulAccC(_pVk, IC34x, IC34y, calldataload(add(pubSignals, 1056)))
                
                g1_mulAccC(_pVk, IC35x, IC35y, calldataload(add(pubSignals, 1088)))
                
                g1_mulAccC(_pVk, IC36x, IC36y, calldataload(add(pubSignals, 1120)))
                
                g1_mulAccC(_pVk, IC37x, IC37y, calldataload(add(pubSignals, 1152)))
                
                g1_mulAccC(_pVk, IC38x, IC38y, calldataload(add(pubSignals, 1184)))
                
                g1_mulAccC(_pVk, IC39x, IC39y, calldataload(add(pubSignals, 1216)))
                
                g1_mulAccC(_pVk, IC40x, IC40y, calldataload(add(pubSignals, 1248)))
                
                g1_mulAccC(_pVk, IC41x, IC41y, calldataload(add(pubSignals, 1280)))
                
                g1_mulAccC(_pVk, IC42x, IC42y, calldataload(add(pubSignals, 1312)))
                
                g1_mulAccC(_pVk, IC43x, IC43y, calldataload(add(pubSignals, 1344)))
                
                g1_mulAccC(_pVk, IC44x, IC44y, calldataload(add(pubSignals, 1376)))
                
                g1_mulAccC(_pVk, IC45x, IC45y, calldataload(add(pubSignals, 1408)))
                
                g1_mulAccC(_pVk, IC46x, IC46y, calldataload(add(pubSignals, 1440)))
                
                g1_mulAccC(_pVk, IC47x, IC47y, calldataload(add(pubSignals, 1472)))
                
                g1_mulAccC(_pVk, IC48x, IC48y, calldataload(add(pubSignals, 1504)))
                
                g1_mulAccC(_pVk, IC49x, IC49y, calldataload(add(pubSignals, 1536)))
                
                g1_mulAccC(_pVk, IC50x, IC50y, calldataload(add(pubSignals, 1568)))
                
                g1_mulAccC(_pVk, IC51x, IC51y, calldataload(add(pubSignals, 1600)))
                
                g1_mulAccC(_pVk, IC52x, IC52y, calldataload(add(pubSignals, 1632)))
                
                g1_mulAccC(_pVk, IC53x, IC53y, calldataload(add(pubSignals, 1664)))
                
                g1_mulAccC(_pVk, IC54x, IC54y, calldataload(add(pubSignals, 1696)))
                
                g1_mulAccC(_pVk, IC55x, IC55y, calldataload(add(pubSignals, 1728)))
                
                g1_mulAccC(_pVk, IC56x, IC56y, calldataload(add(pubSignals, 1760)))
                

                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F
            
            checkField(calldataload(add(_pubSignals, 0)))
            
            checkField(calldataload(add(_pubSignals, 32)))
            
            checkField(calldataload(add(_pubSignals, 64)))
            
            checkField(calldataload(add(_pubSignals, 96)))
            
            checkField(calldataload(add(_pubSignals, 128)))
            
            checkField(calldataload(add(_pubSignals, 160)))
            
            checkField(calldataload(add(_pubSignals, 192)))
            
            checkField(calldataload(add(_pubSignals, 224)))
            
            checkField(calldataload(add(_pubSignals, 256)))
            
            checkField(calldataload(add(_pubSignals, 288)))
            
            checkField(calldataload(add(_pubSignals, 320)))
            
            checkField(calldataload(add(_pubSignals, 352)))
            
            checkField(calldataload(add(_pubSignals, 384)))
            
            checkField(calldataload(add(_pubSignals, 416)))
            
            checkField(calldataload(add(_pubSignals, 448)))
            
            checkField(calldataload(add(_pubSignals, 480)))
            
            checkField(calldataload(add(_pubSignals, 512)))
            
            checkField(calldataload(add(_pubSignals, 544)))
            
            checkField(calldataload(add(_pubSignals, 576)))
            
            checkField(calldataload(add(_pubSignals, 608)))
            
            checkField(calldataload(add(_pubSignals, 640)))
            
            checkField(calldataload(add(_pubSignals, 672)))
            
            checkField(calldataload(add(_pubSignals, 704)))
            
            checkField(calldataload(add(_pubSignals, 736)))
            
            checkField(calldataload(add(_pubSignals, 768)))
            
            checkField(calldataload(add(_pubSignals, 800)))
            
            checkField(calldataload(add(_pubSignals, 832)))
            
            checkField(calldataload(add(_pubSignals, 864)))
            
            checkField(calldataload(add(_pubSignals, 896)))
            
            checkField(calldataload(add(_pubSignals, 928)))
            
            checkField(calldataload(add(_pubSignals, 960)))
            
            checkField(calldataload(add(_pubSignals, 992)))
            
            checkField(calldataload(add(_pubSignals, 1024)))
            
            checkField(calldataload(add(_pubSignals, 1056)))
            
            checkField(calldataload(add(_pubSignals, 1088)))
            
            checkField(calldataload(add(_pubSignals, 1120)))
            
            checkField(calldataload(add(_pubSignals, 1152)))
            
            checkField(calldataload(add(_pubSignals, 1184)))
            
            checkField(calldataload(add(_pubSignals, 1216)))
            
            checkField(calldataload(add(_pubSignals, 1248)))
            
            checkField(calldataload(add(_pubSignals, 1280)))
            
            checkField(calldataload(add(_pubSignals, 1312)))
            
            checkField(calldataload(add(_pubSignals, 1344)))
            
            checkField(calldataload(add(_pubSignals, 1376)))
            
            checkField(calldataload(add(_pubSignals, 1408)))
            
            checkField(calldataload(add(_pubSignals, 1440)))
            
            checkField(calldataload(add(_pubSignals, 1472)))
            
            checkField(calldataload(add(_pubSignals, 1504)))
            
            checkField(calldataload(add(_pubSignals, 1536)))
            
            checkField(calldataload(add(_pubSignals, 1568)))
            
            checkField(calldataload(add(_pubSignals, 1600)))
            
            checkField(calldataload(add(_pubSignals, 1632)))
            
            checkField(calldataload(add(_pubSignals, 1664)))
            
            checkField(calldataload(add(_pubSignals, 1696)))
            
            checkField(calldataload(add(_pubSignals, 1728)))
            
            checkField(calldataload(add(_pubSignals, 1760)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
