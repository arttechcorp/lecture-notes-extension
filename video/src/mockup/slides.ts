// 자동 생성 — landing/hero-mockup.html 에서 추출. 수정하지 말 것.
// 재생성: node scripts/extract-slides.mjs

export type Slide = {
  title: string;
  subtitle: string;
  page: string;
  inkTitle: string;
  body: string;
  ink: string[];
};

export const slides: Slide[] = [
  {
    "title": "Comparing projects using NPV and IRR",
    "subtitle": "Net Present Value (NPV) and Internal Rate of Return (IRR)",
    "page": "12",
    "inkTitle": "NPV measures value in dollars; IRR measures a percentage return.",
    "body": "<table class=\"lecture-table\"><thead><tr><th></th><th>Year 0</th><th>Year 1</th><th>Year 2</th><th>Year 3</th><th>Year 4</th></tr></thead><tbody><tr><th>Project A</th><td>($1000)</td><td>$400</td><td>$400</td><td>$400</td><td>$400</td></tr><tr><th>Project B</th><td>($1000)</td><td>$600</td><td>$500</td><td>$300</td><td>$200</td></tr><tr><th>Project C</th><td>($1000)</td><td>$200</td><td>$300</td><td>$500</td><td>$600</td></tr></tbody></table>\n                <div class=\"lecture-equations\"><div class=\"lecture-eq-title\">NPV and IRR</div><p>Project A NPV @ 20% WACC = <b>$35</b> / IRR 22%</p><p>Project B NPV @ 20% WACC = <b>$117</b> / IRR 27%</p><p>Project C NPV @ 20% WACC = <b>($46)</b> / IRR 18%</p></div>",
    "ink": [
      "M 679.5 424.9 L 684.5 369.9 L 709.5 422.4 L 717 367.4",
      "M 724.5 425.5 L 732 370.5 Q 764.5 363 762 385.5 Q 757 403 729.5 398",
      "M 767 373.6 Q 774.5 406.1 782 426.1 Q 792 401.1 807 368.6",
      "M815 369 Q841 365 866 369",
      "M854 358 L867 369 L854 381",
      "M 924.5 378.9 Q 904.5 361.4 892 381.4 Q 884.5 393.9 907 398.9 Q 932 403.9 917 418.9 Q 904.5 428.9 887 413.9",
      "M 909.5 358.9 L 899.5 433.9",
      "M 684.5 446.4 L 714.5 443.9",
      "M 702 443.9 L 694.5 496.4",
      "M 682 498.9 L 712 496.4",
      "M 719.5 499.5 L 727 444.5 Q 759.5 437 757 459.5 Q 749.5 474.5 724.5 472",
      "M 734.5 472 L 757 499.5",
      "M 767 500.1 L 774.5 445.1 Q 807 437.6 804.5 460.1 Q 797 475.1 772 472.6",
      "M 782 472.6 L 804.5 500.1",
      "M815 445 Q841 442 866 445",
      "M854 435 L867 445 L854 457",
      "M 889.6 492.4 L 929.2 441.8",
      "M 898.4 446.2 Q 885.2 441.8 885.2 455.1 Q 885.2 468.2 898.4 461.6 Q 907.2 452.8 898.4 446.2",
      "M 922.6 472.6 Q 909.4 468.2 909.4 483.6 Q 911.6 496.9 924.8 488.1 Q 933.6 477.1 922.6 472.6"
    ]
  },
  {
    "title": "Why the timing of cash flows matters",
    "subtitle": "Same initial investment. Different timing. Different value.",
    "page": "13",
    "inkTitle": "Earlier cash flows have more present value at a positive discount rate.",
    "body": "<table class=\"lecture-table\"><thead><tr><th></th><th>Year 1</th><th>Year 2</th><th>Year 3</th><th>Year 4</th></tr></thead><tbody><tr class=\"lecture-highlight\"><th>Project B</th><td>$600</td><td>$500</td><td>$300</td><td>$200</td></tr><tr><th>Project C</th><td>$200</td><td>$300</td><td>$500</td><td>$600</td></tr></tbody></table>\n                <div class=\"lecture-equations\"><div class=\"lecture-eq-title\">Present value at a 20% discount rate</div><p>Earlier cash flows have a higher present value.</p><p>NPV (B) = <b>$117</b> &gt; NPV (C) = <b>−$46</b></p></div>",
    "ink": [
      "M 393.2 505.2 Q 410.8 503.1 410.8 494.2 Q 404.2 485.4 395.4 498.6 Q 386.6 516.2 402 516.2 Q 410.8 516.2 417.4 507.4",
      "M 446 497 Q 437.2 486 428.4 497 Q 419.6 508 426.2 514.6 Q 435 519 443.8 499.2 L 446 492.6 L 441.6 512.4 Q 446 519 452.6 510.2",
      "M 461.4 493.2 L 457 517.4",
      "M 461.4 506.4 Q 468 488.8 474.6 493.2 Q 479 499.8 485.6 495.4",
      "M 490 507.4 Q 507.6 474.4 501 467.8 Q 492.2 463.4 492.2 485.4 L 490 507.4 Q 490 520.6 505.4 509.6",
      "M 516.4 494.8 L 512 512.4 Q 514.2 519 525.2 510.2",
      "M 520.8 479.4 L 520.8 481.6",
      "M 531.8 506.4 Q 549.4 504.2 549.4 495.4 Q 542.8 486.6 534 499.8 Q 525.2 517.4 540.6 517.4 Q 549.4 517.4 556 508.6",
      "M 564.8 492.1 L 560.4 516.2",
      "M 564.8 505.2 Q 571.4 487.6 578 492.1 Q 582.4 498.6 589 494.2",
      "M 598 491.1 Q 613.4 488.8 633.2 491.1",
      "M 598 506.4 L 631 504.2",
      "M 665.4 493.2 L 661 515.2",
      "M 663.2 506.4 Q 674.2 484.4 680.8 493.2 Q 685.2 497.6 678.6 513",
      "M 680.8 506.4 Q 694 484.4 700.6 493.2 Q 705 497.6 698.4 510.8 Q 700.6 517.5 709.4 506.4",
      "M 735.8 493.8 Q 722.6 485 716 500.4 Q 711.6 515.8 727 515.8 Q 740.2 515.8 740.2 500.4 Q 740.2 491.6 731.4 493.8",
      "M 751.2 492.2 L 746.8 516.4",
      "M 751.2 505.4 Q 757.8 487.8 764.4 492.2 Q 768.8 498.8 775.4 494.4",
      "M 779.8 504.2 Q 797.4 502.1 797.4 493.2 Q 790.8 484.4 782 497.6 Q 773.2 515.2 788.6 515.2 Q 797.4 515.2 804 506.4",
      "M 827.2 516.5 L 833.8 468.1 Q 862.4 461.4 860.2 481.2 Q 855.8 496.6 831.6 492.2",
      "M 864.6 470.8 Q 871.2 499.4 877.8 517 Q 886.6 495 899.8 466.4",
      "M389 518 Q584 513 895 516"
    ]
  },
  {
    "title": "Choosing between investment projects",
    "subtitle": "Two measures. Two different questions.",
    "page": "14",
    "inkTitle": "Compare the value created, not just the percentage return.",
    "body": "<div class=\"lecture-definitions\"><p><b>NPV</b><span>How much value does the project create?</span></p><p><b>IRR</b><span>What rate of return does the project earn?</span></p></div>\n                <div class=\"lecture-equations\"><div class=\"lecture-eq-title\">Key takeaway</div><p>For mutually exclusive projects of different sizes,</p><p>compare the <b>value created</b>, not just the percentage return.</p></div>",
    "ink": [
      "M 532.5 485.4 Q 537.5 502.9 542.5 513 Q 550 502.9 562.5 480.4",
      "M 595 488.5 Q 585 476 575 488.5 Q 565 501 572.5 508.5 Q 582.5 513.5 592.5 491 L 595 483.5 L 590 506 Q 595 513.5 602.5 503.5",
      "M 610 501.6 Q 630 464.1 622.5 456.6 Q 612.5 451.6 612.5 476.6 L 610 501.6 Q 610 516.5 627.5 504.1",
      "M 640 482.9 Q 630 518 645 507.9 L 660 482.9 L 655 505.4 Q 657.5 513 670 500.4",
      "M 675 498.5 Q 695 496 695 486 Q 687.5 476 677.5 491 Q 667.5 511 685 511 Q 695 511 702.5 501",
      "M 715 506.6 Q 720 514 710 524",
      "M 745 486.4 L 740 511.4",
      "M 742.5 501.4 Q 762.5 473.9 770 486.4 Q 775 491.4 767.5 506.4 Q 770 514 780 501.4",
      "M 807.5 487 Q 792.5 477 785 494.5 Q 780 512 797.5 512 Q 812.5 512 812.5 494.5 Q 812.5 484.5 802.5 487",
      "M 837.5 465.1 L 827.5 502.6 Q 825 520 845 505.1",
      "M 820 487.6 L 850 482.6",
      "M 882.5 514 L 927.5 456.4",
      "M 892.5 461.4 Q 877.5 456.4 877.5 471.4 Q 877.5 486.4 892.5 478.9 Q 902.5 468.9 892.5 461.4",
      "M 920 491.4 Q 905 486.4 905 503.9 Q 907.5 519 922.5 508.9 Q 932.5 496.4 920 491.4",
      "M530 522 Q610 516 700 520"
    ]
  }
];
