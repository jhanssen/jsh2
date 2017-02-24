{
  "targets": [
   {
      "include_dirs": [
	"<!(node -e \"require('nan')\")"
      ],
      "target_name": "native-jsh",
      "sources": [ "jsh.cpp", "utils.cpp", "SignalBase.cpp", "Job.cpp" ],
      "cflags_cc": [ "-std=c++14" ],
      "xcode_settings": {
	"OTHER_CPLUSPLUSFLAGS": [
	  "-std=c++14"
	]
      }
    }
  ]
}
