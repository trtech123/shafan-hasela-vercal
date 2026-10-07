import { orderDelivery } from "./_deployed_shared/order-delivery/runtime.ts";
Deno.serve(orderDelivery("email"));
