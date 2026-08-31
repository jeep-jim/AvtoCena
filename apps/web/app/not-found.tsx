import { permanentRedirect } from "next/navigation";

// Catalog links can remain in search engines, chats and browser history after
// the source listing disappears from a newer catalog generation. Never strand
// that visitor on the framework 404: move every missing public page to the live
// catalog and give crawlers a permanent replacement target.
export default function NotFound() {
  permanentRedirect("/cars");
}
