# Flight Booking System Test Plan

## Prerequisites

1. Kubernetes cluster is up and running
2. `kubectl` is configured to access the cluster
3. Docker images are built and available:
   ```bash
   # Build all service images
   docker build -t rabbitmq-delayed:latest ./rabbitmq
   docker build -t client-service:latest ./client-service
   docker build -t booking-service:latest ./booking-service
   docker build -t payment-service:latest ./payment-service
   docker build -t notification-service:latest ./notification-service
   ```

## Deployment Steps

1. Apply Kubernetes manifests:

   ```bash
   kubectl apply -k k8s/base
   ```

2. Wait for all pods to be ready:

   ```bash
   kubectl get pods -w
   ```

3. Port-forward services for local access:
   ```bash
   # Client Service API
   kubectl port-forward --address 0.0.0.0 svc/client-service 3000:3000 &
   # RabbitMQ Management UI
   kubectl port-forward --address 0.0.0.0 svc/rabbitmq 15672:15672 &
   # Mailpit Web UI
   kubectl port-forward --address 0.0.0.0 svc/mailpit 8025:8025 &
   ```

## Test Scenarios

### 1. Microservices Interaction Test

**Objective**: Verify end-to-end flow from Client Service to Notification Service through RabbitMQ.

**Steps**:

1. Create a booking:

   ```bash
   curl -X POST http://localhost:3000/bookings \
     -H "Content-Type: application/json" \
     -d '{
       "flight_id": "your_flight_id",
       "user_email": "test@example.com",
       "num_seats": 1
     }'
   ```

2. Check booking status:

   ```bash
   curl http://localhost:3000/bookings/{booking_id}
   ```

3. Process payment:

   ```bash
   # Attach to payment service pod
   kubectl attach $(kubectl get pod -l app=payment-service -o jsonpath='{.items[0].metadata.name}') -it
   # Enter 's' for success
   ```

4. Verify notifications:
   - Open Mailpit UI at http://localhost:8025
   - Check for booking confirmation email

**Expected Results**:

- Booking is created successfully
- Payment request is processed
- Notification email is sent
- Booking status changes to CONFIRMED

### 2. Message Queue Test

**Objective**: Verify message persistence when Notification Service is down.

**Steps**:

1. Scale down Notification Service:

   ```bash
   kubectl scale deployment notification-service --replicas=0
   ```

2. Create multiple bookings:

   ```bash
   # Create 3 test bookings
   for i in {1..3}; do
     curl -X POST http://localhost:3000/bookings \
       -H "Content-Type: application/json" \
       -d '{
         "flight_id": "47ccb123-34c0-454d-b234-44e712a2a781",
         "user_email": "test${i}@example.com",
         "num_seats": 1
       }'
   done
   ```

3. Process payments for all bookings

4. Scale up Notification Service:
   ```bash
   kubectl scale deployment notification-service --replicas=1
   ```

**Expected Results**:

- All messages are queued in RabbitMQ
- After Notification Service restarts, all queued messages are processed
- All notification emails are sent in order

### 3. Scalability Test

**Objective**: Measure response time improvement with Booking Service scaling.

**Steps**:

1. Run baseline load test:

   ```bash
   # Using Apache Bench for 1000 requests with 10 concurrent users
   k6 run test.js
   ```

2. Scale up Booking Service:

   ```bash
   kubectl scale deployment booking-service --replicas=4
   ```

3. Run load test again with same parameters

**Expected Results**:

- Response time should decrease
- Success rate should remain 100%
- Load should be distributed across pods (check logs)

### 4. Fault Tolerance Test

**Objective**: Verify automatic pod recovery and message processing continuity.

**Steps**:

1. Delete a Notification Service pod:

   ```bash
   kubectl delete pod -l app=notification-service --wait=false
   ```

2. Monitor pod recreation:

   ```bash
   kubectl get pods -w -l app=notification-service
   ```

3. Create a test booking and complete payment

**Expected Results**:

- Pod is automatically recreated
- New pod starts processing messages
- Test booking notification is delivered

## Debugging Guide

### Common Issues and Solutions

1. **Pods Stuck in Pending State**

   ```bash
   # Check pod events
   kubectl describe pod <pod-name>
   # Check persistent volume claims
   kubectl get pvc
   ```

2. **Database Migration Failures**

   ```bash
   # Check client-service init container logs
   kubectl logs <client-service-pod> -c run-migrations
   ```

3. **RabbitMQ Connection Issues**

   ```bash
   # Check RabbitMQ logs
   kubectl logs -l app=rabbitmq
   # Verify RabbitMQ plugins
   kubectl exec -it <rabbitmq-pod> -- rabbitmq-plugins list
   ```

4. **Service Discovery Problems**
   ```bash
   # Test DNS resolution
   kubectl run -it --rm debug --image=busybox -- nslookup booking-service
   ```

### Monitoring Tools

1. **Pod Metrics**:

   ```bash
   kubectl top pods
   ```

2. **Service Logs**:

   ```bash
   # Stream logs from all pods of a service
   kubectl logs -f -l app=booking-service
   ```

3. **RabbitMQ Queue Status**:
   ```bash
   # Port-forward RabbitMQ management UI
   kubectl port-forward svc/rabbitmq 15672:15672
   # Access http://localhost:15672 (guest/guest)
   ```

## Performance Metrics

Track the following metrics during testing:

1. **Response Times**:

   - API endpoint latency
   - gRPC call duration
   - Message processing time

2. **Resource Usage**:

   - CPU and memory consumption
   - Network I/O
   - Queue length

3. **Error Rates**:
   - Failed requests
   - Message processing failures
   - Pod restarts

## Test Data Management

1. **Database Seeding**:

   ```bash
   # Manually trigger seeding if needed
   kubectl exec -it <client-service-pod> -- npx prisma db seed
   ```

2. **Cleanup Test Data**:
   ```bash
   # Reset database (caution: removes all data)
   kubectl exec -it <client-service-pod> -- npx prisma migrate reset --force
   ```

## Troubleshooting Tips

1. **Check Service Connectivity**:

   ```bash
   # Test service endpoints
   kubectl run -it --rm debug --image=curlimages/curl -- curl http://client-service:3000/schedules
   ```

2. **Verify Message Flow**:

   ```bash
   # Check RabbitMQ queues
   kubectl exec -it <rabbitmq-pod> -- rabbitmqctl list_queues
   ```

3. **Database Connectivity**:
   ```bash
   # Test PostgreSQL connection
   kubectl exec -it <postgres-pod> -- psql -U postgres -d flight_booking -c "\dt"
   ```
