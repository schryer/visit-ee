// How this build is served: a preview keeps search engines out.
export default {
  env: process.env.VISIT_EE_ENV || "preview",
  url: process.env.VISIT_EE_URL || "",
  preview: (process.env.VISIT_EE_ENV || "preview") !== "production",
};
